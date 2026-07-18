// Camada de dados da agenda: fala com o Postgres do Supabase pela API REST.
//
// Sem biblioteca: `fetch` puro poupa uns 40 KB de download no celular, que é de
// onde vem quase todo o tráfego. Duas rotas, e só:
//
//   POST /rest/v1/rpc/horarios_ocupados  -> o que já está tomado (sem quem tomou)
//   POST /rest/v1/agendamentos           -> grava a reserva
//
// A leitura passa por uma função no banco em vez da tabela porque a tabela é
// cega para o público: nome e telefone dos clientes nunca trafegam para cá.
// Quem valida de verdade é o banco (veja as políticas em supabase/), não este
// arquivo — a chave do site é pública e qualquer um pode chamar a API direto.

import { BANCO, PASSO_MIN } from './config.js';

const cabecalho = {
  apikey: BANCO.chave,
  Authorization: `Bearer ${BANCO.chave}`,
  'Content-Type': 'application/json',
};

const FALHA_REDE = 'Não deu para falar com a agenda. Confira sua internet e tente de novo.';

async function pedir(rota, corpo, extras = {}) {
  let resposta;
  try {
    resposta = await fetch(`${BANCO.url}/rest/v1/${rota}`, {
      method: 'POST',
      headers: { ...cabecalho, ...extras },
      body: JSON.stringify(corpo),
    });
  } catch {
    throw new Error(FALHA_REDE); // offline, DNS, CORS
  }
  return resposta;
}

/**
 * Horários tomados entre duas datas, agrupados por dia.
 * `inicio` é "HH:MM" e `blocos` é quantos passos de 30 min o serviço ocupa.
 */
export async function listarOcupadosPeriodo(deISO, ateISO) {
  const resposta = await pedir('rpc/horarios_ocupados', { de: deISO, ate: ateISO });
  if (!resposta.ok) throw new Error(FALHA_REDE);

  const porDia = {};
  for (const linha of await resposta.json()) {
    (porDia[linha.data] ??= []).push({
      inicio: linha.inicio.slice(0, 5),          // "14:00:00" -> "14:00"
      blocos: Math.ceil(linha.duracao_min / PASSO_MIN),
    });
  }
  return porDia;
}

export async function criarAgendamento({ servicoId, data, inicio, duracao, nome, telefone }) {
  // `return=minimal`: sem isto o Postgres tentaria devolver a linha gravada, e
  // o público não tem permissão de ler a tabela — a reserva entraria e a
  // resposta viria com erro.
  const resposta = await pedir(
    'agendamentos',
    { servico_id: servicoId, data, inicio, duracao_min: duracao, nome, telefone },
    { Prefer: 'return=minimal' },
  );

  if (resposta.ok) return { ok: true };

  const erro = await resposta.json().catch(() => ({}));

  // 23P01: a restrição de exclusão pegou uma sobreposição. Alguém marcou esse
  // horário entre a hora em que a tela desenhou e a hora em que ele clicou.
  if (erro.code === '23P01') {
    throw new Error('Esse horário acabou de ser preenchido. Escolha outro.');
  }
  // 42501: a política recusou (dia fechado, data no passado, telefone inválido).
  if (erro.code === '42501' || resposta.status === 401 || resposta.status === 403) {
    throw new Error('Esse horário não está disponível. Atualize a página e tente de novo.');
  }
  throw new Error(FALHA_REDE);
}
