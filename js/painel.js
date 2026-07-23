// A agenda do dia, para o Marcos. Lê a tabela inteira (nome e telefone
// inclusive), o que só funciona porque ele está logado e consta na tabela
// `equipe`. Para o público essa mesma tabela é cega — veja supabase/schema.sql.

import { ESTUDIO, DIAS_SEMANA, buscarServico } from './config.js';
import { entrar, sair, estaLogado, comSessao, SessaoExpirada } from './sessao.js';
import { iniciarAjustes } from './painel-ajustes.js';
import { iniciarAssinantes } from './painel-assinantes.js';
import { iniciarCaixa } from './painel-caixa.js';

const iso = (data) => {
  const d = new Date(data);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

const dinheiro = (v) => `R$ ${v.toFixed(2).replace('.', ',')}`;
const soDigitos = (s) => s.replace(/\D/g, '');

let diaAberto = new Date();

/* ── Telas ───────────────────────────────────────────────── */

function mostrarEntrar() {
  document.getElementById('painel').hidden = true;
  document.getElementById('entrar').hidden = false;
  document.getElementById('entrar-email').focus();
}

function mostrarPainel() {
  document.getElementById('entrar').hidden = true;
  document.getElementById('painel').hidden = false;
  // Sempre abre na aba Agenda.
  document.getElementById('aba-agenda').hidden = false;
  document.getElementById('aba-caixa').hidden = true;
  document.getElementById('aba-assinantes').hidden = true;
  document.getElementById('aba-ajustes').hidden = true;
  document.querySelectorAll('.aba').forEach((b) => b.setAttribute('aria-selected', String(b.id === 'tab-agenda')));
  carregarDia();
  carregarProximas();
}

/* ── Login ───────────────────────────────────────────────── */

function ligarLogin() {
  const form = document.getElementById('form-entrar');
  const erro = document.getElementById('entrar-erro');
  const botao = document.getElementById('entrar-botao');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    erro.hidden = true;
    botao.disabled = true;
    botao.textContent = 'Entrando…';

    try {
      await entrar(
        document.getElementById('entrar-email').value.trim(),
        document.getElementById('entrar-senha').value,
      );
      document.getElementById('entrar-senha').value = '';
      mostrarPainel();
    } catch (falha) {
      erro.textContent = falha.message;
      erro.hidden = false;
    } finally {
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  });

  document.getElementById('sair').addEventListener('click', async () => {
    await sair();
    mostrarEntrar();
  });
}

/* ── Abas: Agenda | Ajustes ──────────────────────────────── */

function ligarAbas() {
  const botoes = [...document.querySelectorAll('.aba')];
  const paineis = {
    agenda: document.getElementById('aba-agenda'),
    caixa: document.getElementById('aba-caixa'),
    assinantes: document.getElementById('aba-assinantes'),
    ajustes: document.getElementById('aba-ajustes'),
  };
  botoes.forEach((b) => b.addEventListener('click', () => {
    const alvo = b.dataset.aba;
    botoes.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    for (const [nome, pane] of Object.entries(paineis)) pane.hidden = nome !== alvo;
    // Recarrega fresco do banco toda vez que a aba abre.
    if (alvo === 'caixa') iniciarCaixa({ aoExpirar: mostrarEntrar });
    if (alvo === 'ajustes') iniciarAjustes({ aoExpirar: mostrarEntrar });
    if (alvo === 'assinantes') iniciarAssinantes({ aoExpirar: mostrarEntrar });
  }));
}

/* ── Navegar entre dias ──────────────────────────────────── */

function ligarNavegacao() {
  const andar = (dias) => {
    diaAberto.setDate(diaAberto.getDate() + dias);
    carregarDia();
  };
  document.getElementById('dia-antes').addEventListener('click', () => andar(-1));
  document.getElementById('dia-depois').addEventListener('click', () => andar(1));
  document.getElementById('dia-hoje').addEventListener('click', () => {
    diaAberto = new Date();
    carregarDia();
  });
}

/* ── A lista do dia ──────────────────────────────────────── */

function pintarCabecalho() {
  const hoje = iso(new Date()) === iso(diaAberto);
  const titulo = diaAberto.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
  document.getElementById('painel-dia').textContent = hoje ? `Hoje, ${titulo}` : titulo;
  document.getElementById('dia-hoje').disabled = hoje;

  const el = document.getElementById('painel-dia');
  el.dataset.semana = DIAS_SEMANA[diaAberto.getDay()];
}

async function carregarDia() {
  pintarCabecalho();
  const lista = document.getElementById('lista');
  const resumo = document.getElementById('painel-resumo');
  const erro = document.getElementById('painel-erro');
  erro.hidden = true;
  lista.innerHTML = '<p class="vazio">Carregando…</p>';

  try {
    const resposta = await comSessao(
      `agendamentos?data=eq.${iso(diaAberto)}&order=inicio.asc`,
      { method: 'GET' },
    );
    if (!resposta.ok) throw new Error('Não deu para carregar a agenda.');
    const reservas = await resposta.json();
    pintarLista(reservas);

    const total = reservas.reduce((soma, r) => soma + (buscarServico(r.servico_id)?.preco ?? 0), 0);
    resumo.textContent = reservas.length
      ? `${reservas.length} ${reservas.length === 1 ? 'horário' : 'horários'} · ${dinheiro(total)}`
      : '';
  } catch (falha) {
    if (falha instanceof SessaoExpirada) { mostrarEntrar(); return; }
    lista.replaceChildren();
    resumo.textContent = '';
    erro.textContent = falha.message;
    erro.hidden = false;
  }
}

/* ── Próximas reservas ───────────────────────────────────── */

// Uma faixa de atalhos no topo: os dias que têm reserva daqui pra frente, com a
// contagem. O Marcos abre o painel e já vê o que está por vir, sem precisar
// clicar dia a dia — foi o que fez uma reserva do dia 23 "sumir" para ele.
async function carregarProximas() {
  const caixa = document.getElementById('proximas');
  try {
    const resposta = await comSessao(
      `agendamentos?select=data&data=gte.${iso(new Date())}&order=data.asc`,
      { method: 'GET' },
    );
    if (!resposta.ok) { caixa.hidden = true; return; }

    const contagem = {};
    for (const { data } of await resposta.json()) contagem[data] = (contagem[data] || 0) + 1;
    const dias = Object.keys(contagem).sort().slice(0, 14);

    caixa.replaceChildren();
    if (!dias.length) { caixa.hidden = true; return; }

    const titulo = document.createElement('p');
    titulo.className = 'proximas__titulo';
    titulo.textContent = 'Próximas reservas';
    caixa.append(titulo);

    const fila = document.createElement('div');
    fila.className = 'proximas__fila';
    for (const d of dias) {
      const chip = document.createElement('button');
      chip.className = 'proxima-chip';
      chip.type = 'button';
      const rotulo = new Date(`${d}T12:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      chip.innerHTML = `${rotulo}<span class="proxima-chip__n">${contagem[d]}</span>`;
      chip.addEventListener('click', () => { diaAberto = new Date(`${d}T12:00`); carregarDia(); });
      fila.append(chip);
    }
    caixa.append(fila);
    caixa.hidden = false;
  } catch (falha) {
    if (falha instanceof SessaoExpirada) { mostrarEntrar(); return; }
    caixa.hidden = true;
  }
}

function pintarLista(reservas) {
  const lista = document.getElementById('lista');
  lista.replaceChildren();

  if (!reservas.length) {
    const p = document.createElement('p');
    p.className = 'vazio';
    p.textContent = DIAS_SEMANA[diaAberto.getDay()] === 'Domingo'
      || DIAS_SEMANA[diaAberto.getDay()] === 'Segunda'
      ? 'Fechado.'
      : 'Nenhum horário marcado.';
    lista.append(p);
    return;
  }

  for (const r of reservas) {
    const servico = buscarServico(r.servico_id);
    const item = document.createElement('article');
    item.className = 'reserva';
    item.innerHTML = `
      <p class="reserva__hora">${r.inicio.slice(0, 5)}</p>
      <div class="reserva__quem">
        <p class="reserva__nome"></p>
        <p class="reserva__servico">${servico ? servico.nome : r.servico_id}
          <span class="reserva__preco">${servico ? dinheiro(servico.preco) : ''}</span>
        </p>
      </div>
      <div class="reserva__acoes">
        <a class="reserva__zap" target="_blank" rel="noopener">WhatsApp</a>
        <button class="reserva__cancelar" type="button">Cancelar</button>
      </div>`;

    // textContent, não innerHTML: o nome vem do cliente e pode conter qualquer coisa.
    item.querySelector('.reserva__nome').textContent = r.nome;

    const zap = item.querySelector('.reserva__zap');
    zap.href = `https://wa.me/55${soDigitos(r.telefone)}`;
    zap.textContent = r.telefone;

    item.querySelector('.reserva__cancelar')
      .addEventListener('click', () => cancelar(r, item));

    lista.append(item);
  }
}

/* ── Cancelar ────────────────────────────────────────────── */

async function cancelar(reserva, item) {
  const certeza = confirm(
    `Cancelar o horário de ${reserva.nome}, às ${reserva.inicio.slice(0, 5)}?\n\n`
    + 'O cliente não é avisado: fale com ele.',
  );
  if (!certeza) return;

  const botao = item.querySelector('.reserva__cancelar');
  botao.disabled = true;
  botao.textContent = 'Cancelando…';

  try {
    const resposta = await comSessao(`agendamentos?id=eq.${reserva.id}`, { method: 'DELETE' });
    if (!resposta.ok) throw new Error('Não deu para cancelar. Tente de novo.');
    await carregarDia();
    carregarProximas();
  } catch (falha) {
    if (falha instanceof SessaoExpirada) { mostrarEntrar(); return; }
    const erro = document.getElementById('painel-erro');
    erro.textContent = falha.message;
    erro.hidden = false;
    botao.disabled = false;
    botao.textContent = 'Cancelar';
  }
}

/* ── Início ──────────────────────────────────────────────── */

document.title = `Agenda · ${ESTUDIO.nome}`;
ligarLogin();
ligarNavegacao();
ligarAbas();

if (estaLogado()) mostrarPainel();
else mostrarEntrar();
