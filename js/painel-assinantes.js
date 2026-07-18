// A aba "Assinantes" do painel: quem assina os planos mensais e o controle de
// pagamento do mês (em dia / atrasado). Dados pessoais → tudo pela sessão da
// equipe; o público nunca lê estas tabelas.

import { SessaoExpirada } from './sessao.js';
import { el, api, corpoJson, dinheiro, soDigitos } from './painel-comum.js';

let aoExpirar = () => {};
let planos = [];
let templateCobranca = '';

export function iniciarAssinantes(opcoes = {}) {
  aoExpirar = opcoes.aoExpirar || (() => {});
  render();
}

const raiz = () => document.getElementById('assinantes-conteudo');

// Competência = primeiro dia do mês atual (a linha de pagamento é por mês).
const compAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const nomeMes = () => new Date().toLocaleDateString('pt-BR', { month: 'long' });

/* ── Montagem ────────────────────────────────────────────── */

async function render() {
  const alvo = raiz();
  alvo.replaceChildren(el('p', { class: 'ajustes-carregando', text: 'Carregando…' }));
  const comp = compAtual();

  let assinantes;
  let pagos;
  try {
    const [ra, rp, rpl, rc] = await Promise.all([
      api('assinantes?select=*&order=status.asc,nome.asc', { method: 'GET' }),
      api(`pagamentos_assinatura?select=assinante_id&competencia=eq.${comp}`, { method: 'GET' }),
      api('servicos?select=id,nome,preco&tipo=eq.plano&order=ordem.asc', { method: 'GET' }),
      api('ajustes?select=valor&chave=eq.cobranca', { method: 'GET' }),
    ]);
    assinantes = await ra.json();
    pagos = new Set((await rp.json()).map((p) => p.assinante_id));
    planos = await rpl.json();
    templateCobranca = (await rc.json())[0]?.valor?.mensagem || '';
  } catch (falha) {
    if (falha instanceof SessaoExpirada) return aoExpirar();
    alvo.replaceChildren(el('p', { class: 'ajustes-erro', text: falha.message }));
    return;
  }

  const hoje = new Date().getDate();
  const ativos = assinantes.filter((a) => a.status === 'ativo');
  const atrasados = ativos.filter((a) => !pagos.has(a.id) && hoje > a.dia_vencimento);

  const lista = el('div', { class: 'assinantes-lista' });
  if (!assinantes.length) {
    lista.append(el('p', { class: 'assinante-vazio', text: 'Nenhum assinante ainda.' }));
  } else {
    assinantes.forEach((a) => lista.append(cartaoAssinante(a, pagos.has(a.id), hoje)));
  }

  alvo.replaceChildren(
    el('div', { class: 'assinantes-topo' },
      el('h2', { class: 'ajustes-grupo__titulo', text: 'Assinantes' }),
      el('p', { class: 'assinantes-resumo', text:
        `${ativos.length} ${ativos.length === 1 ? 'ativo' : 'ativos'} · `
        + `${atrasados.length} atrasado${atrasados.length === 1 ? '' : 's'} em ${nomeMes()}` }),
    ),
    lista,
    formNovo(),
  );
}

/* ── Peças de formulário ─────────────────────────────────── */

function selectPlano(atual) {
  const s = el('select', { class: 'edit-campo' });
  const ids = new Set(planos.map((p) => p.id));
  if (atual && !ids.has(atual)) s.append(el('option', { value: atual, text: `${atual} (inativo)`, selected: true }));
  if (!planos.length) s.append(el('option', { value: '', text: '— sem plano —' }));
  planos.forEach((p) => s.append(el('option', { value: p.id, text: `${p.nome} — ${dinheiro(p.preco)}`, selected: p.id === atual })));
  return s;
}

function selectStatus(atual) {
  const s = el('select', { class: 'edit-campo' });
  [['ativo', 'Ativo'], ['pausado', 'Pausado'], ['cancelado', 'Cancelado']]
    .forEach(([v, t]) => s.append(el('option', { value: v, text: t, selected: v === atual })));
  return s;
}

const rotulo = (txt, ctrl, cls = '') =>
  el('label', { class: `edit-rotulo ${cls}`.trim() }, el('span', { text: txt }), ctrl);

/* ── Cartão de um assinante ──────────────────────────────── */

function cartaoAssinante(a, pago, hoje) {
  const nome = el('input', { class: 'edit-campo', type: 'text', value: a.nome, maxLength: 80 });
  const tel = el('input', { class: 'edit-campo', type: 'tel', value: a.telefone });
  const plano = selectPlano(a.plano_id);
  const venc = el('input', { class: 'edit-campo assinante-venc', type: 'number', min: '1', max: '31', value: a.dia_vencimento });
  const status = selectStatus(a.status);
  const info = el('span', { class: 'edit-status' });

  const salvar = el('button', { class: 'edit-salvar', type: 'button', text: 'Salvar', disabled: true });
  const sujar = () => { salvar.disabled = false; info.textContent = ''; };
  [nome, tel, venc].forEach((c) => c.addEventListener('input', sujar));
  [plano, status].forEach((c) => c.addEventListener('change', sujar));

  salvar.addEventListener('click', async () => {
    if (nome.value.trim().length < 1) { info.textContent = 'Escreva o nome.'; return; }
    salvar.disabled = true;
    info.textContent = 'Salvando…';
    try {
      await api(`assinantes?id=eq.${a.id}`, corpoJson({
        method: 'PATCH',
        body: JSON.stringify({
          nome: nome.value.trim(),
          telefone: tel.value.trim(),
          plano_id: plano.value || null,
          dia_vencimento: Number(venc.value) || 5,
          status: status.value,
        }),
      }));
      render(); // status pode ter mudado → recomputa resumo e badges
    } catch (falha) {
      if (falha instanceof SessaoExpirada) return aoExpirar();
      salvar.disabled = false;
      info.textContent = falha.message;
    }
  });

  const remover = el('button', {
    class: 'edit-remover', type: 'button', text: 'Remover',
    onclick: async () => {
      if (!confirm(`Remover o assinante "${a.nome}"? Apaga também o histórico de pagamentos dele.`)) return;
      try {
        await api(`assinantes?id=eq.${a.id}`, corpoJson({ method: 'DELETE' }));
        render();
      } catch (falha) {
        if (falha instanceof SessaoExpirada) return aoExpirar();
        alert(falha.message);
      }
    },
  });

  const zap = el('a', { class: 'reserva__zap', href: `https://wa.me/55${soDigitos(a.telefone)}`, target: '_blank', rel: 'noopener', text: 'WhatsApp' });

  return el('div', { class: 'assinante-card' },
    el('div', { class: 'assinante-grade' },
      rotulo('Nome', nome, 'assinante-col-larga'),
      rotulo('Status', status),
      rotulo('Telefone', tel),
      rotulo('Plano', plano),
      rotulo('Vence dia', venc, 'assinante-col-venc'),
    ),
    blocoPagamento(a, pago, hoje),
    el('div', { class: 'edit-acoes' }, zap, salvar, info, remover),
  );
}

/** Monta a mensagem de cobrança a partir do modelo do Marcos, trocando os {campos}. */
function mensagemCobranca(a) {
  const plano = planos.find((p) => p.id === a.plano_id);
  const campos = {
    nome: a.nome,
    plano: plano ? plano.nome : 'assinatura',
    valor: plano ? dinheiro(plano.preco) : '',
    mes: nomeMes(),
    vencimento: `dia ${a.dia_vencimento}`,
  };
  return (templateCobranca || '').replace(/\{(\w+)\}/g, (m, k) => (k in campos ? campos[k] : m));
}

/** Badge do mês + botão marcar pago / desfazer + cobrar (só para assinante ativo). */
function blocoPagamento(a, pago, hoje) {
  const bloco = el('div', { class: 'assinante-pag' });

  if (a.status !== 'ativo') {
    bloco.append(el('span', { class: 'pag-badge pag-badge--off', text: a.status === 'pausado' ? 'Pausado' : 'Cancelado' }));
    return bloco;
  }

  const atrasado = !pago && hoje > a.dia_vencimento;
  const badge = pago
    ? el('span', { class: 'pag-badge pag-badge--ok', text: '● Pago este mês' })
    : el('span', { class: `pag-badge ${atrasado ? 'pag-badge--atraso' : 'pag-badge--aberto'}`, text: atrasado ? '⚠ Atrasado' : `A vencer · dia ${a.dia_vencimento}` });

  const botao = el('button', {
    class: 'edit-salvar', type: 'button', text: pago ? 'Desfazer' : 'Marcar pago',
    onclick: async () => {
      const comp = compAtual();
      botao.disabled = true;
      try {
        if (pago) {
          await api(`pagamentos_assinatura?assinante_id=eq.${a.id}&competencia=eq.${comp}`, corpoJson({ method: 'DELETE' }));
        } else {
          const p = planos.find((x) => x.id === a.plano_id);
          await api('pagamentos_assinatura', corpoJson({ method: 'POST', body: JSON.stringify({ assinante_id: a.id, competencia: comp, valor: p ? p.preco : null }) }));
        }
        render();
      } catch (falha) {
        if (falha instanceof SessaoExpirada) return aoExpirar();
        botao.disabled = false;
        alert(falha.message);
      }
    },
  });

  const cobrar = el('a', {
    class: 'assinante-cobrar',
    href: `https://wa.me/55${soDigitos(a.telefone)}?text=${encodeURIComponent(mensagemCobranca(a))}`,
    target: '_blank', rel: 'noopener', text: 'Cobrar',
  });

  bloco.append(badge, botao, cobrar);
  return bloco;
}

/* ── Novo assinante ──────────────────────────────────────── */

function formNovo() {
  const nome = el('input', { class: 'edit-campo', type: 'text', placeholder: 'Nome do assinante', maxLength: 80 });
  const tel = el('input', { class: 'edit-campo', type: 'tel', placeholder: '(22) 90000-0000' });
  const plano = selectPlano(planos[0] ? planos[0].id : '');
  const venc = el('input', { class: 'edit-campo assinante-venc', type: 'number', min: '1', max: '31', value: 5 });
  const info = el('span', { class: 'edit-status' });

  const add = el('button', {
    class: 'edit-salvar', type: 'button', text: 'Adicionar assinante',
    onclick: async () => {
      if (nome.value.trim().length < 1) { info.textContent = 'Escreva o nome.'; return; }
      if (soDigitos(tel.value).length < 10) { info.textContent = 'Informe um telefone com DDD.'; return; }
      add.disabled = true;
      info.textContent = 'Salvando…';
      try {
        await api('assinantes', corpoJson({
          method: 'POST',
          body: JSON.stringify({
            nome: nome.value.trim(),
            telefone: tel.value.trim(),
            plano_id: plano.value || null,
            dia_vencimento: Number(venc.value) || 5,
            status: 'ativo',
          }),
        }));
        render();
      } catch (falha) {
        if (falha instanceof SessaoExpirada) return aoExpirar();
        add.disabled = false;
        info.textContent = falha.message;
      }
    },
  });

  return el('section', { class: 'assinante-novo' },
    el('h3', { class: 'assinante-novo__titulo', text: 'Novo assinante' }),
    el('div', { class: 'assinante-grade' },
      rotulo('Nome', nome, 'assinante-col-larga'),
      rotulo('Telefone', tel),
      rotulo('Plano', plano),
      rotulo('Vence dia', venc, 'assinante-col-venc'),
    ),
    el('div', { class: 'edit-acoes' }, add, info),
  );
}
