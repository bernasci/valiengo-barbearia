// Config do estúdio. Antes os preços/horários/serviços viviam aqui, fixos;
// agora vêm do banco, para o Marcos editar pelo painel (tabelas servicos,
// horarios e ajustes). Este arquivo busca esses dados no carregamento e os
// expõe com os mesmos nomes de antes, então o resto do site quase não muda.
//
// A fonte de verdade é o banco. O PADRAO abaixo só entra em cena se a rede
// falhar — para o site não ficar em branco numa queda. Duplicação consciente:
// mexeu no serviço pelo painel, o banco manda; o PADRAO é só o paraquedas.

// Conexão. A chave é publicável de propósito: vai no HTML, à vista de todos, e
// não é segredo. Quem protege os dados é o RLS no Postgres. A chave secreta
// (service_role) NÃO pode aparecer aqui.
export const BANCO = {
  url: 'https://lbozziokrhdpwevwpyhf.supabase.co',
  chave: 'sb_publishable_XT0QzsXouQUSvlnjeQ3ugw_3NJxGzSo',
};

// Estático, não editável: nomes dos dias da semana.
export const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// ── Paraquedas: valores usados só se o banco não responder ───────────────────
const PADRAO = {
  servicos: [
    { id: 'corte', nome: 'Corte', preco: 40, duracao: 30 },
    { id: 'barba', nome: 'Barba', preco: 25, duracao: 30 },
    { id: 'corte-barba', nome: 'Corte e barba', preco: 55, duracao: 30 },
    { id: 'corte-barba-sobrancelha', nome: 'Corte, barba e sobrancelha', preco: 70, duracao: 45 },
    { id: 'corte-kids', nome: 'Corte kids', preco: 45, duracao: 45, apartir: true },
    { id: 'acabamento', nome: 'Acabamento', preco: 15, duracao: 15 },
    { id: 'sobrancelha', nome: 'Sobrancelha', preco: 15, duracao: 15 },
    { id: 'pigmentacao', nome: 'Pigmentação', preco: 30, duracao: 30 },
    { id: 'escova', nome: 'Escova', preco: 65, duracao: 45 },
  ],
  planos: [
    { id: 'mensal-corte', nome: 'Corte', preco: 100, duracao: 30, dias: [2, 3, 4] },
    { id: 'mensal-corte-sobrancelha', nome: 'Corte e sobrancelha', preco: 130, duracao: 30, dias: [2, 3, 4] },
    { id: 'mensal-corte-barba', nome: 'Corte e barba', preco: 140, duracao: 30, dias: [2, 3, 4] },
  ],
  horarios: {
    2: [['09:30', '12:30'], ['14:00', '20:00']],
    3: [['09:30', '12:30'], ['14:00', '20:00']],
    4: [['09:30', '12:30'], ['14:00', '20:00']],
    5: [['09:30', '12:30'], ['14:00', '20:00']],
    6: [['09:30', '12:30'], ['14:00', '20:00']],
  },
  estudio: {
    nome: 'Valiengo',
    telefone: '(22) 99909-0823',
    whatsapp: '5522999090823',
    instagram: 'https://www.instagram.com/valiengo.barbearia/',
    barbeiro: 'Marcos',
    endereco: {
      linha1: 'Rua Ângelo Antônio Mendonça, 64',
      linha2: 'Porto Seguro · São João da Barra/RJ',
      cep: '28200-000',
      mapa: 'https://www.google.com/maps/search/?api=1&query=-21.63936234%2C-41.04711151',
    },
    pagamentos: ['Dinheiro', 'PIX', 'Cartão de crédito', 'Cartão de débito'],
    comodidades: ['Wi-Fi', 'Estacionamento', 'Acessibilidade', 'Atende crianças'],
  },
  reserva: { passo_min: 30, janela_dias: 60, limite_dias: 90, duracao_max: 60 },
};

// ── Busca a config no banco e a molda no formato que o site espera ───────────

const cabecalho = { apikey: BANCO.chave, Authorization: `Bearer ${BANCO.chave}` };

async function buscar(rota) {
  const r = await fetch(`${BANCO.url}/rest/v1/${rota}`, { headers: cabecalho });
  if (!r.ok) throw new Error(`Falha ao ler ${rota}: ${r.status}`);
  return r.json();
}

/** Linha da tabela `servicos` -> objeto que o site usa (duracao_min -> duracao). */
function moldarServico(s) {
  const o = { id: s.id, nome: s.nome, preco: Number(s.preco), duracao: s.duracao_min };
  if (s.apartir) o.apartir = true;
  if (s.dias) o.dias = s.dias;
  return o;
}

async function carregar() {
  const [servicos, horarios, ajustes] = await Promise.all([
    buscar('servicos?select=*&ativo=eq.true&order=ordem.asc'),
    buscar('horarios?select=dia,abre,fecha&order=dia.asc,ordem.asc'),
    buscar('ajustes?select=chave,valor'),
  ]);

  const porChave = Object.fromEntries(ajustes.map((a) => [a.chave, a.valor]));
  const grade = {};
  for (const t of horarios) {
    (grade[t.dia] ??= []).push([t.abre.slice(0, 5), t.fecha.slice(0, 5)]);
  }

  return {
    servicos: servicos.filter((s) => s.tipo === 'servico').map(moldarServico),
    planos: servicos.filter((s) => s.tipo === 'plano').map(moldarServico),
    horarios: grade,
    estudio: porChave.estudio ?? PADRAO.estudio,
    reserva: porChave.reserva ?? PADRAO.reserva,
  };
}

// Top-level await: os módulos que importam este esperam a config chegar. Se a
// rede falhar, cai no PADRAO e o site abre mesmo assim.
let cfg;
try {
  cfg = await carregar();
} catch (falha) {
  console.warn('Config do banco indisponível, usando padrão:', falha);
  cfg = PADRAO;
}

// ── O que o resto do site importa (mesmos nomes de sempre) ───────────────────

export const SERVICOS = cfg.servicos;
export const PLANOS = cfg.planos;
export const HORARIOS = cfg.horarios;
export const ESTUDIO = cfg.estudio;
export const PASSO_MIN = cfg.reserva.passo_min ?? 30;

export const TODOS_SERVICOS = [...SERVICOS, ...PLANOS];
export const buscarServico = (id) => TODOS_SERVICOS.find((s) => s.id === id);
