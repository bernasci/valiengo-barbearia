// Perfil do cliente, salvo só neste aparelho (localStorage). Não é uma conta
// segura: é uma conveniência para o cliente não redigitar nome e celular a cada
// agendamento. Nada aqui vai para o banco além do que a própria reserva já
// gravava (nome e telefone). Por ser local, é por aparelho — não sincroniza.

const CHAVE = 'valiengo:cliente';

let perfil = null;
try {
  perfil = JSON.parse(localStorage.getItem(CHAVE));
} catch {
  perfil = null;
}

export const obterPerfil = () => perfil;

export const estaLogado = () => Boolean(perfil && perfil.nome && perfil.telefone);

export function salvarPerfil({ nome, telefone }) {
  perfil = { nome: nome.trim(), telefone: telefone.trim() };
  localStorage.setItem(CHAVE, JSON.stringify(perfil));
  return perfil;
}

export function sairPerfil() {
  perfil = null;
  localStorage.removeItem(CHAVE);
}
