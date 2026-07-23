// A aba "Caixa" do painel: faturamento estimado a partir dos cortes marcados na
// agenda. É só leitura — soma o preço de tabela de cada serviço avulso das
// reservas, por dia / semana / mês. Não é o dinheiro que entrou de fato: conta
// o que está marcado. Mensalistas (planos) NÃO entram na receita — a
// mensalidade deles vive na aba Assinantes; aqui aparecem só como contagem de
// atendimentos, para o número de cortes não mentir.

import { SessaoExpirada } from './sessao.js';
import { el, api, dinheiro } from './painel-comum.js';
import { PLANOS, buscarServico } from './config.js';

let aoExpirar = () => {};

export function iniciarCaixa(opcoes = {}) {
  aoExpirar = opcoes.aoExpirar || (() => {});
  render();
}

const raiz = () => document.getElementById('caixa-conteudo');

const ehPlano = (id) => PLANOS.some((p) => p.id === id);

// Só o serviço avulso vira dinheiro no caixa; o plano é contado em Assinantes.
const valorDe = (r) => (ehPlano(r.servico_id) ? 0 : buscarServico(r.servico_id)?.preco ?? 0);

const iso = (d) => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 10);
};

// Segunda a domingo: assim a semana de trabalho (ter–sáb) cai inteira num balde.
function limitesSemana(base) {
  const ini = new Date(base);
  ini.setDate(ini.getDate() - ((ini.getDay() + 6) % 7)); // recua até segunda
  const fim = new Date(ini);
  fim.setDate(ini.getDate() + 6);
  return [ini, fim];
}

function limitesMes(base) {
  return [
    new Date(base.getFullYear(), base.getMonth(), 1),
    new Date(base.getFullYear(), base.getMonth() + 1, 0),
  ];
}

/* ── Montagem ────────────────────────────────────────────── */

async function render() {
  const alvo = raiz();
  alvo.replaceChildren(el('p', { class: 'ajustes-carregando', text: 'Carregando…' }));

  const hoje = new Date();
  const [iniSem, fimSem] = limitesSemana(hoje);
  const [iniMes, fimMes] = limitesMes(hoje);

  // Uma leitura só, cobrindo semana e mês (a semana fura o mês nas viradas).
  const de = iso(iniSem < iniMes ? iniSem : iniMes);
  const ate = iso(fimSem > fimMes ? fimSem : fimMes);

  let reservas;
  try {
    const r = await api(
      `agendamentos?select=data,servico_id&data=gte.${de}&data=lte.${ate}&order=data.asc`,
      { method: 'GET' },
    );
    reservas = await r.json();
  } catch (falha) {
    if (falha instanceof SessaoExpirada) return aoExpirar();
    alvo.replaceChildren(el('p', { class: 'ajustes-erro', text: falha.message }));
    return;
  }

  const hojeISO = iso(hoje);
  const [semDe, semAte] = [iso(iniSem), iso(fimSem)];
  const [mesDe, mesAte] = [iso(iniMes), iso(fimMes)];

  const somar = (filtro) => {
    const sel = reservas.filter(filtro);
    return {
      receita: sel.reduce((s, r) => s + valorDe(r), 0),
      cortes: sel.length,
      assinantes: sel.filter((r) => ehPlano(r.servico_id)).length,
    };
  };

  const noMes = reservas.filter((r) => r.data >= mesDe && r.data <= mesAte);

  // Dia a dia do mês (só dias com corte).
  const porDia = {};
  for (const r of noMes) {
    (porDia[r.data] ??= { receita: 0, cortes: 0 }).receita += valorDe(r);
    porDia[r.data].cortes += 1;
  }

  // Por serviço no mês (só avulsos).
  const porServico = {};
  for (const r of noMes) {
    if (ehPlano(r.servico_id)) continue;
    const s = buscarServico(r.servico_id);
    const nome = s ? s.nome : r.servico_id;
    (porServico[nome] ??= { receita: 0, n: 0 });
    porServico[nome].receita += valorDe(r);
    porServico[nome].n += 1;
  }

  alvo.replaceChildren(
    el('div', { class: 'caixa-topo' },
      el('h2', { class: 'ajustes-grupo__titulo', text: 'Caixa' }),
      el('p', { class: 'caixa-sub', text: 'Faturamento estimado pelos cortes marcados na agenda.' }),
    ),
    el('div', { class: 'caixa-cards' },
      cardCaixa('Hoje', somar((r) => r.data === hojeISO)),
      cardCaixa('Esta semana', somar((r) => r.data >= semDe && r.data <= semAte)),
      cardCaixa('Este mês', somar((r) => r.data >= mesDe && r.data <= mesAte)),
    ),
    blocoDias(porDia),
    blocoServicos(porServico),
    el('p', { class: 'caixa-nota', text:
      'Soma o preço de tabela de cada serviço avulso marcado. Não inclui '
      + 'mensalistas (a mensalidade fica em Assinantes), gorjeta nem produto — e '
      + 'um horário não cancelado conta mesmo se o cliente faltar.' }),
  );
}

/* ── Peças ───────────────────────────────────────────────── */

const plural = (n, sing, plur) => `${n} ${n === 1 ? sing : plur}`;

function cardCaixa(rotulo, { receita, cortes, assinantes }) {
  const meta = assinantes
    ? `${plural(cortes, 'corte', 'cortes')} · ${plural(assinantes, 'assinante', 'assinantes')}`
    : plural(cortes, 'corte', 'cortes');
  return el('div', { class: 'caixa-card' },
    el('p', { class: 'caixa-card__rotulo', text: rotulo }),
    el('p', { class: 'caixa-card__valor', text: dinheiro(receita) }),
    el('p', { class: 'caixa-card__meta', text: meta }),
  );
}

function linha(rotuloTxt, contagem, receita) {
  return el('div', { class: 'caixa-linha' },
    el('span', { class: 'caixa-linha__dia', text: rotuloTxt }),
    el('span', { class: 'caixa-linha__n', text: contagem }),
    el('span', { class: 'caixa-linha__valor', text: dinheiro(receita) }),
  );
}

function blocoDias(porDia) {
  const bloco = el('section', { class: 'caixa-bloco' },
    el('h3', { class: 'caixa-bloco__titulo', text: 'Este mês, dia a dia' }));

  const dias = Object.keys(porDia).sort().reverse(); // mais recente primeiro
  if (!dias.length) {
    bloco.append(el('p', { class: 'caixa-vazio', text: 'Nenhum corte marcado no mês.' }));
    return bloco;
  }

  const lista = el('div', { class: 'caixa-linhas' });
  for (const d of dias) {
    const { receita, cortes } = porDia[d];
    const rotulo = new Date(`${d}T12:00`)
      .toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    lista.append(linha(rotulo, plural(cortes, 'corte', 'cortes'), receita));
  }
  bloco.append(lista);
  return bloco;
}

function blocoServicos(porServico) {
  const nomes = Object.keys(porServico)
    .sort((a, b) => porServico[b].receita - porServico[a].receita);
  if (!nomes.length) return null;

  const bloco = el('section', { class: 'caixa-bloco' },
    el('h3', { class: 'caixa-bloco__titulo', text: 'Por serviço (mês)' }));
  const lista = el('div', { class: 'caixa-linhas' });
  for (const nome of nomes) {
    const { receita, n } = porServico[nome];
    lista.append(linha(nome, `${n}×`, receita));
  }
  bloco.append(lista);
  return bloco;
}
