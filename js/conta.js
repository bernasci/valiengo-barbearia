// A conta do cliente na masthead: o botão "Entrar" / nome, e o modal de perfil.
// Guarda os dados via perfil.js (localStorage). O agendamento (app.js) usa
// pedirLogin() quando um visitante sem perfil tenta reservar.

import { obterPerfil, estaLogado, salvarPerfil, sairPerfil } from './perfil.js';

const $ = (id) => document.getElementById(id);
const soDigitos = (s) => s.replace(/\D/g, '');

// Resolve a Promise de pedirLogin() quando o modal fecha.
let resolverLogin = null;

function mascarar(campo) {
  campo.addEventListener('input', () => {
    const d = soDigitos(campo.value).slice(0, 11);
    campo.value = d.length <= 2 ? d
      : d.length <= 7 ? `(${d.slice(0, 2)}) ${d.slice(2)}`
      : `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  });
}

function atualizarBotao() {
  const btn = $('topo-conta');
  if (estaLogado()) {
    btn.textContent = obterPerfil().nome.trim().split(/\s+/)[0]; // primeiro nome
    btn.dataset.logado = 'sim';
    btn.setAttribute('aria-label', 'Seu perfil');
  } else {
    btn.textContent = 'Entrar';
    btn.dataset.logado = 'nao';
    btn.setAttribute('aria-label', 'Entrar');
  }
  // app.js escuta para atualizar o resumo da reserva.
  document.dispatchEvent(new CustomEvent('conta:mudou'));
}

function abrir() {
  const logado = estaLogado();
  const p = obterPerfil();
  $('modal-titulo').textContent = logado ? 'Seu perfil' : 'Entrar';
  $('modal-texto').textContent = logado
    ? 'Seus dados ficam salvos neste aparelho. Edite quando quiser.'
    : 'Deixe seu nome e celular — fica salvo neste aparelho e agiliza seus agendamentos.';
  $('conta-nome').value = logado ? p.nome : '';
  $('conta-telefone').value = logado ? p.telefone : '';
  $('conta-salvar').textContent = logado ? 'Salvar' : 'Entrar';
  $('conta-sair').hidden = !logado;
  $('conta-erro').hidden = true;
  $('modal-conta').hidden = false;
  setTimeout(() => $('conta-nome').focus(), 50);
}

function fechar() {
  $('modal-conta').hidden = true;
  if (resolverLogin) { resolverLogin(estaLogado()); resolverLogin = null; }
}

/** Abre o modal de login e resolve true se o cliente entrou, false se desistiu. */
export function pedirLogin() {
  return new Promise((resolve) => { resolverLogin = resolve; abrir(); });
}

export function iniciarConta() {
  mascarar($('conta-telefone'));
  atualizarBotao();

  $('topo-conta').addEventListener('click', abrir);
  $('modal-x').addEventListener('click', fechar);
  $('modal-conta').querySelector('.modal__fundo').addEventListener('click', fechar);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('modal-conta').hidden) fechar();
  });

  $('form-conta').addEventListener('submit', (e) => {
    e.preventDefault();
    const erro = $('conta-erro');
    erro.hidden = true;
    const nome = $('conta-nome').value.trim();
    const telefone = $('conta-telefone').value.trim();
    if (nome.length < 2) {
      erro.textContent = 'Escreva seu nome, como o Marcos te chama.';
      erro.hidden = false;
      return;
    }
    if (soDigitos(telefone).length < 10) {
      erro.textContent = 'Informe um celular com DDD.';
      erro.hidden = false;
      return;
    }
    salvarPerfil({ nome, telefone });
    atualizarBotao();
    fechar();
  });

  $('conta-sair').addEventListener('click', () => {
    sairPerfil();
    atualizarBotao();
    fechar();
  });
}
