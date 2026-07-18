// Peças compartilhadas pelos editores do painel (ajustes, assinantes): a
// ferramentinha de DOM e o atalho de chamada autenticada. Sem innerHTML — todo
// texto entra por textContent, porque muito dele vem do cliente/Marcos.

import { comSessao } from './sessao.js';

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) n.append(kid);
  return n;
}

/** Chamada autenticada que estoura em erro; deixa SessaoExpirada subir. */
export async function api(rota, opcoes) {
  const r = await comSessao(rota, opcoes);
  if (!r.ok) {
    const corpo = await r.text().catch(() => '');
    throw new Error(`Não deu certo (${r.status}). ${corpo.slice(0, 140)}`.trim());
  }
  return r;
}

export const corpoJson = (extra) => ({ headers: { Prefer: 'return=minimal' }, ...extra });
export const dinheiro = (v) => `R$ ${Number(v).toFixed(2).replace('.', ',')}`;
export const soDigitos = (s) => String(s).replace(/\D/g, '');
