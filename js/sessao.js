// Login do Marcos, direto na API de auth do Supabase.
//
// A senha dele só transita no momento do login, sobre HTTPS, e nunca é
// guardada aqui: o que fica no aparelho são os tokens, que expiram e podem ser
// revogados no painel do Supabase se o celular sumir.

import { BANCO } from './config.js';

const CHAVE = 'valiengo:sessao';

const base = {
  apikey: BANCO.chave,
  'Content-Type': 'application/json',
};

let sessao = null;

try {
  sessao = JSON.parse(localStorage.getItem(CHAVE));
} catch {
  sessao = null;
}

const guardar = (s) => {
  sessao = s;
  if (s) localStorage.setItem(CHAVE, JSON.stringify(s));
  else localStorage.removeItem(CHAVE);
};

export const estaLogado = () => Boolean(sessao?.access_token);

export async function entrar(email, senha) {
  let resposta;
  try {
    resposta = await fetch(`${BANCO.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: base,
      body: JSON.stringify({ email, password: senha }),
    });
  } catch {
    throw new Error('Sem conexão. Confira a internet e tente de novo.');
  }

  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    if (resposta.status === 400) throw new Error('E-mail ou senha não conferem.');
    if (resposta.status === 429) throw new Error('Muitas tentativas. Espere um minuto.');
    throw new Error(corpo.error_description || corpo.msg || 'Não deu para entrar.');
  }

  guardar({ access_token: corpo.access_token, refresh_token: corpo.refresh_token });
  return true;
}

export async function sair() {
  if (sessao?.access_token) {
    // Se a rede falhar, o token local some do mesmo jeito: sair tem que sair.
    await fetch(`${BANCO.url}/auth/v1/logout`, {
      method: 'POST',
      headers: { ...base, Authorization: `Bearer ${sessao.access_token}` },
    }).catch(() => {});
  }
  guardar(null);
}

/** Renova o acesso com o refresh token. Devolve false se a sessão morreu. */
async function renovar() {
  if (!sessao?.refresh_token) return false;
  try {
    const resposta = await fetch(`${BANCO.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: base,
      body: JSON.stringify({ refresh_token: sessao.refresh_token }),
    });
    if (!resposta.ok) { guardar(null); return false; }
    const corpo = await resposta.json();
    guardar({ access_token: corpo.access_token, refresh_token: corpo.refresh_token });
    return true;
  } catch {
    return false; // rede caiu: a sessão pode estar viva, não jogue fora
  }
}

/**
 * Chama a API como o Marcos. O token de acesso dura ~1h; quando vence, isto
 * renova sozinho e repete a chamada, para ele não ser deslogado no meio do dia.
 */
export async function comSessao(rota, opcoes = {}) {
  const chamar = () => fetch(`${BANCO.url}/rest/v1/${rota}`, {
    ...opcoes,
    headers: { ...base, ...opcoes.headers, Authorization: `Bearer ${sessao.access_token}` },
  });

  if (!sessao?.access_token) throw new SessaoExpirada();

  let resposta;
  try {
    resposta = await chamar();
  } catch {
    throw new Error('Sem conexão. Confira a internet e tente de novo.');
  }

  if (resposta.status === 401) {
    if (!(await renovar())) throw new SessaoExpirada();
    resposta = await chamar();
    if (resposta.status === 401) throw new SessaoExpirada();
  }
  return resposta;
}

export class SessaoExpirada extends Error {
  constructor() {
    super('Sua sessão expirou. Entre de novo.');
    this.name = 'SessaoExpirada';
  }
}
