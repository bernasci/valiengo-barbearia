import {
  ESTUDIO, HORARIOS, DIAS_SEMANA, SERVICOS, PLANOS,
  PASSO_MIN, buscarServico,
} from './config.js';
import { listarOcupadosPeriodo, criarAgendamento } from './agenda.js';

/* ── Utilidades de tempo ─────────────────────────────────── */

const paraMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const paraHora = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const iso = (data) => {
  const d = new Date(data);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

const blocosDe = (duracao) => Math.ceil(duracao / PASSO_MIN);

/** Todos os inícios possíveis do dia, na grade de 30 min. */
const gradeDoDia = (diaSemana) =>
  (HORARIOS[diaSemana] ?? []).flatMap(([abre, fecha]) => {
    const grade = [];
    for (let m = paraMin(abre); m + PASSO_MIN <= paraMin(fecha); m += PASSO_MIN) {
      grade.push(m);
    }
    return grade;
  });

/** Um serviço só cabe se todos os blocos que ele ocupa existirem no mesmo turno. */
const cabeNoTurno = (diaSemana, inicioMin, blocos) =>
  (HORARIOS[diaSemana] ?? []).some(
    ([abre, fecha]) =>
      inicioMin >= paraMin(abre) &&
      inicioMin + blocos * PASSO_MIN <= paraMin(fecha),
  );

const dinheiro = (v) => `R$ ${v.toFixed(2).replace('.', ',')}`;

/* ── Estado da reserva ───────────────────────────────────── */

const escolha = { servicoId: null, data: null, inicio: null };

/** Agenda dos próximos dias, carregada de uma vez e reusada entre os passos. */
let ocupacao = {};

const DIAS_NA_FRENTE = 60;

/**
 * Horários de um dia para um serviço, já sabendo o que está tomado e o que
 * ficou no passado. Só devolve o que cabe inteiro dentro de um turno.
 */
function slotsDoDia(dataISO, servico) {
  const semana = new Date(`${dataISO}T12:00`).getDay();
  const blocos = blocosDe(servico.duracao);

  const tomados = new Set();
  for (const { inicio, blocos: b } of ocupacao[dataISO] ?? []) {
    for (let i = 0; i < b; i++) tomados.add(paraMin(inicio) + i * PASSO_MIN);
  }

  const agora = new Date();
  const ehHoje = dataISO === iso(agora);
  const minAgora = agora.getHours() * 60 + agora.getMinutes();

  return gradeDoDia(semana)
    .filter((min) => cabeNoTurno(semana, min, blocos))
    .map((min) => {
      const vago = Array.from({ length: blocos }, (_, i) => min + i * PASSO_MIN)
        .every((m) => !tomados.has(m));
      return { min, hora: paraHora(min), disponivel: vago && (!ehHoje || min > minAgora) };
    });
}

/** Dias que ainda têm ao menos uma vaga para o serviço escolhido. */
function diasComVaga(servico) {
  const dias = [];
  const hoje = new Date();

  for (let i = 0; i < DIAS_NA_FRENTE && dias.length < 14; i++) {
    const d = new Date(hoje);
    d.setDate(d.getDate() + i);
    const semana = d.getDay();

    if (!HORARIOS[semana]) continue;
    if (servico.dias && !servico.dias.includes(semana)) continue;
    if (!slotsDoDia(iso(d), servico).some((s) => s.disponivel)) continue;

    dias.push(d);
  }
  return dias;
}

async function carregarOcupacao() {
  const hoje = new Date();
  const fim = new Date(hoje);
  fim.setDate(fim.getDate() + DIAS_NA_FRENTE);
  ocupacao = await listarOcupadosPeriodo(iso(hoje), iso(fim));
}

/**
 * Sem a agenda carregada, a tela mostraria todo horário como livre e mandaria
 * o cliente bater de frente com o banco. Melhor travar e dizer o que houve.
 */
function travarAgenda(mensagem) {
  const aviso = document.getElementById('erro-agenda');
  aviso.textContent = mensagem;
  aviso.hidden = false;
  for (const id of ['passo-data', 'passo-hora', 'passo-dados']) {
    document.getElementById(id).disabled = true;
  }
  document.getElementById('opcoes-servico').querySelectorAll('input')
    .forEach((i) => { i.disabled = true; });
  document.getElementById('btn-confirmar').disabled = true;
}

function destravarAgenda() {
  document.getElementById('erro-agenda').hidden = true;
  document.getElementById('opcoes-servico').querySelectorAll('input')
    .forEach((i) => { i.disabled = false; });
}

/* ── Estado do estúdio: aberto agora? ────────────────────── */

function pintarEstado() {
  const el = document.getElementById('estado');
  const agora = new Date();
  const turnos = HORARIOS[agora.getDay()] ?? [];
  const min = agora.getHours() * 60 + agora.getMinutes();
  const aberto = turnos.some(([a, f]) => min >= paraMin(a) && min < paraMin(f));

  if (aberto) {
    const [, fecha] = turnos.find(([a, f]) => min >= paraMin(a) && min < paraMin(f));
    el.dataset.estado = 'aberto';
    el.querySelector('.estado__texto').textContent = `Aberto agora · até ${fecha}`;
    return;
  }

  // Próximo turno: varre os próximos 7 dias.
  for (let i = 0; i < 8; i++) {
    const d = new Date(agora);
    d.setDate(d.getDate() + i);
    const turnosDoDia = HORARIOS[d.getDay()] ?? [];
    const proximo = turnosDoDia.find(([a]) => i > 0 || paraMin(a) > min);
    if (proximo) {
      const quando = i === 0 ? 'hoje' : i === 1 ? 'amanhã' : DIAS_SEMANA[d.getDay()].toLowerCase();
      el.dataset.estado = 'fechado';
      el.querySelector('.estado__texto').textContent = `Fechado · abre ${quando} às ${proximo[0]}`;
      return;
    }
  }
  el.dataset.estado = 'fechado';
  el.querySelector('.estado__texto').textContent = 'Fechado';
}

/* ── Tabela de serviços ──────────────────────────────────── */

function linhaServico(s, { sufixo } = {}) {
  const li = document.createElement('li');
  li.className = 'tabela__item';
  li.innerHTML = `
    <span class="tabela__nome">${s.nome}<span class="tabela__dur">${s.duracao} min</span></span>
    <span class="tabela__preco">
      ${s.apartir ? '<span class="tabela__apartir">a partir de</span>' : ''}${dinheiro(s.preco)}${
        sufixo ? `<span class="tabela__sufixo">${sufixo}</span>` : ''
      }
    </span>`;
  return li;
}

function pintarServicos() {
  const tabela = document.getElementById('tabela-servicos');
  SERVICOS.forEach((s) => tabela.append(linhaServico(s)));

  const planos = document.getElementById('tabela-planos');
  PLANOS.forEach((p) => planos.append(linhaServico(p, { sufixo: ' /mês' })));
}

/* ── Passo 1 · serviço ───────────────────────────────────── */

function pintarOpcoesServico() {
  const caixa = document.getElementById('opcoes-servico');
  const lista = [
    ...SERVICOS.map((s) => ({ ...s, meta: `${dinheiro(s.preco)} · ${s.duracao} min` })),
    ...PLANOS.map((p) => ({ ...p, nome: `${p.nome} — mensal`, meta: `${dinheiro(p.preco)}/mês · ter a qui` })),
  ];

  lista.forEach((s) => {
    const rotulo = document.createElement('label');
    rotulo.className = 'ficha';
    rotulo.innerHTML = `
      <input type="radio" name="servico" value="${s.id}">
      <span class="ficha__corpo">
        <span class="ficha__titulo">${s.nome}</span>
        <span class="ficha__meta">${s.meta}</span>
      </span>`;
    caixa.append(rotulo);
  });

  // Um listener por caixa, ligado no início. Repintar as fichas não os duplica.
  caixa.addEventListener('change', (e) => {
    escolha.servicoId = e.target.value;
    escolha.data = null;
    escolha.inicio = null;
    document.getElementById('passo-data').disabled = false;
    pintarDias();
    limparHoras();
    atualizarResumo();
  });
}

/* ── Passo 2 · dia ───────────────────────────────────────── */

function pintarDias() {
  const caixa = document.getElementById('opcoes-data');
  const servico = buscarServico(escolha.servicoId);
  caixa.replaceChildren();

  const dias = diasComVaga(servico);

  if (!dias.length) {
    const p = document.createElement('p');
    p.className = 'aviso';
    p.textContent = 'Sem vaga para esse serviço nas próximas semanas. Fale com o Marcos no WhatsApp.';
    caixa.append(p);
    return;
  }

  for (const d of dias) {
    const rotulo = document.createElement('label');
    rotulo.className = 'ficha';
    rotulo.innerHTML = `
      <input type="radio" name="data" value="${iso(d)}">
      <span class="ficha__corpo">
        <span class="ficha__meta">${DIAS_SEMANA[d.getDay()].slice(0, 3)}</span>
        <span class="ficha__dia">${String(d.getDate()).padStart(2, '0')}</span>
        <span class="ficha__meta">${d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</span>
      </span>`;
    caixa.append(rotulo);
  }
}

function ligarPassoData() {
  document.getElementById('opcoes-data').addEventListener('change', (e) => {
    escolha.data = e.target.value;
    escolha.inicio = null;
    document.getElementById('passo-hora').disabled = false;
    document.getElementById('passo-dados').disabled = true;
    pintarHoras();
    atualizarResumo();
  });
}

/* ── Passo 3 · hora ──────────────────────────────────────── */

function limparHoras() {
  document.getElementById('opcoes-hora').replaceChildren();
  document.getElementById('aviso-hora').hidden = true;
  document.getElementById('passo-hora').disabled = true;
  document.getElementById('passo-dados').disabled = true;
}

function pintarHoras() {
  const caixa = document.getElementById('opcoes-hora');
  const aviso = document.getElementById('aviso-hora');
  caixa.replaceChildren();

  const slots = slotsDoDia(escolha.data, buscarServico(escolha.servicoId));

  // Só os horários livres aparecem. Um horário tomado (ou já passado) some da
  // lista em vez de ficar riscado — a grade mostra apenas o que dá para marcar.
  for (const { hora, disponivel } of slots) {
    if (!disponivel) continue;
    const rotulo = document.createElement('label');
    rotulo.className = 'ficha';
    rotulo.innerHTML = `
      <input type="radio" name="hora" value="${hora}">
      <span class="ficha__corpo">${hora}</span>`;
    caixa.append(rotulo);
  }

  const livres = slots.filter((s) => s.disponivel).length;
  aviso.hidden = livres > 0;
  aviso.textContent = 'Nenhum horário livre nesse dia. Tente outro.';
}

function ligarPassoHora() {
  document.getElementById('opcoes-hora').addEventListener('change', (e) => {
    escolha.inicio = e.target.value;
    document.getElementById('passo-dados').disabled = false;
    atualizarResumo();
  });
}

/* ── Resumo ──────────────────────────────────────────────── */

function dataPorExtenso(dataISO) {
  const d = new Date(`${dataISO}T12:00`);
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

function atualizarResumo() {
  const servico = escolha.servicoId ? buscarServico(escolha.servicoId) : null;
  const ehPlano = servico && PLANOS.some((p) => p.id === servico.id);

  document.getElementById('r-servico').textContent = servico ? servico.nome : '—';
  document.getElementById('r-quando').textContent =
    escolha.data && escolha.inicio ? `${dataPorExtenso(escolha.data)}, ${escolha.inicio}` : '—';
  document.getElementById('r-valor').textContent = servico
    ? dinheiro(servico.preco) + (ehPlano ? ' /mês' : '')
    : '—';

  document.getElementById('btn-confirmar').disabled =
    !(escolha.servicoId && escolha.data && escolha.inicio);
}

/* ── Passo 4 · envio ─────────────────────────────────────── */

const soDigitos = (s) => s.replace(/\D/g, '');

function mascararTelefone(campo) {
  campo.addEventListener('input', () => {
    const d = soDigitos(campo.value).slice(0, 11);
    campo.value = d.length <= 2 ? d
      : d.length <= 7 ? `(${d.slice(0, 2)}) ${d.slice(2)}`
      : `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  });
}

function ligarFormulario() {
  const form = document.getElementById('form-agenda');
  const erro = document.getElementById('erro-form');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    erro.hidden = true;

    const nome = document.getElementById('campo-nome').value.trim();
    const telefone = document.getElementById('campo-telefone').value.trim();

    if (nome.length < 2) {
      erro.textContent = 'Escreva seu nome para o Marcos saber quem chega.';
      erro.hidden = false;
      return;
    }
    if (soDigitos(telefone).length < 10) {
      erro.textContent = 'Informe um celular com DDD, assim ele consegue te avisar.';
      erro.hidden = false;
      return;
    }

    const servico = buscarServico(escolha.servicoId);
    const btn = document.getElementById('btn-confirmar');
    btn.disabled = true;

    try {
      await criarAgendamento({
        servicoId: servico.id,
        data: escolha.data,
        inicio: escolha.inicio,
        duracao: servico.duracao,
        nome,
        telefone,
      });
      mostrarBilhete({ servico, nome });
      await carregarOcupacao().catch(() => {}); // o bilhete já saiu; releitura é bônus
    } catch (falha) {
      erro.textContent = falha.message;
      erro.hidden = false;
      btn.disabled = false;
      // Se o horário foi tomado por outro, repinta a grade com a agenda fresca.
      try {
        await carregarOcupacao();
        pintarHoras();
      } catch {
        travarAgenda('A agenda saiu do ar. Atualize a página para tentar de novo.');
      }
    }
  });
}

function mostrarBilhete({ servico, nome }) {
  const form = document.getElementById('form-agenda');
  const caderno = document.querySelector('.caderno');
  const bilhete = document.getElementById('bilhete');

  document.getElementById('bilhete-titulo').textContent =
    `${servico.nome} · ${dataPorExtenso(escolha.data)}, ${escolha.inicio}`;

  const texto =
    `Olá! Sou ${nome}. Reservei ${servico.nome} para ` +
    `${dataPorExtenso(escolha.data)} às ${escolha.inicio} pelo site.`;
  document.getElementById('bilhete-zap').href =
    `https://wa.me/${ESTUDIO.whatsapp}?text=${encodeURIComponent(texto)}`;

  caderno.hidden = true;
  bilhete.hidden = false;
  bilhete.scrollIntoView({ behavior: 'smooth', block: 'center' });

  document.getElementById('bilhete-novo').addEventListener('click', () => {
    form.reset();
    escolha.servicoId = escolha.data = escolha.inicio = null;
    document.getElementById('passo-data').disabled = true;
    limparHoras();
    atualizarResumo();
    bilhete.hidden = true;
    caderno.hidden = false;
    caderno.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, { once: true });
}

/* ── Visita ──────────────────────────────────────────────── */

function pintarVisita() {
  const { endereco, pagamentos, telefone, whatsapp, instagram } = ESTUDIO;

  document.getElementById('endereco').innerHTML =
    `${endereco.linha1}<br>${endereco.linha2}<br>${endereco.cep}`;
  document.getElementById('link-mapa').href = endereco.mapa;

  const corpo = document.querySelector('#horarios tbody');
  const hoje = new Date().getDay();
  DIAS_SEMANA.forEach((nome, i) => {
    const turnos = HORARIOS[i];
    const tr = document.createElement('tr');
    if (i === hoje) tr.dataset.hoje = 'sim';
    tr.innerHTML = `
      <td class="horarios__dia">${nome}</td>
      <td class="horarios__hora">${
        turnos
          ? turnos.map(([a, f]) => `${a} – ${f}`).join('<br>')
          : '<span class="horarios__fechado">Fechado</span>'
      }</td>`;
    corpo.append(tr);
  });

  const pag = document.getElementById('pagamentos');
  pagamentos.forEach((p) => {
    const li = document.createElement('li');
    li.textContent = p;
    pag.append(li);
  });

  const tel = document.getElementById('link-tel');
  tel.textContent = telefone;
  tel.href = `https://wa.me/${whatsapp}`;
  document.getElementById('link-insta').href = instagram;
}

/* ── Barra de agendar do celular ─────────────────────────── */

function ligarBarra() {
  const barra = document.getElementById('barra');
  const capa = document.querySelector('.capa');
  const agenda = document.getElementById('agendar');

  const naTela = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  };

  // Enquanto a capa (que já tem o botão) ou a agenda estiverem à vista, a
  // barra é redundante. Ela aparece no miolo, onde o cliente lê preço.
  const avaliar = () => {
    barra.dataset.visivel = naTela(capa) || naTela(agenda) ? 'nao' : 'sim';
  };

  let agendado = false;
  const aoRolar = () => {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => { agendado = false; avaliar(); });
  };

  addEventListener('scroll', aoRolar, { passive: true });
  addEventListener('resize', aoRolar, { passive: true });
  avaliar();

  // Repete o estado do estúdio: quem vê a barra já rolou para longe da capa.
  const estado = document.getElementById('estado');
  const texto = estado.querySelector('.estado__texto').textContent;
  if (estado.dataset.estado === 'aberto') {
    document.getElementById('barra-estado').textContent = texto.replace('Aberto agora · ', '');
  }

  barra.hidden = false;
}

/* ── Revelação ao rolar ──────────────────────────────────── */

// Melhoria progressiva: só entra se houver movimento permitido e suporte a
// IntersectionObserver. A classe .revela (que esconde até revelar) é adicionada
// aqui, então sem JS nada fica invisível.
function ligarRevelacao() {
  const querMovimento = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!querMovimento || !('IntersectionObserver' in window)) return;

  const alvos = document.querySelectorAll(
    '.secao__topo, .quadro, .planos, .caderno, .visita__bloco, .rodape',
  );
  const obs = new IntersectionObserver((entradas, o) => {
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('dentro');
      o.unobserve(e.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  alvos.forEach((el) => { el.classList.add('revela'); obs.observe(el); });
}

/* ── Início ──────────────────────────────────────────────── */

pintarEstado();
pintarServicos();
pintarOpcoesServico();
pintarVisita();
mascararTelefone(document.getElementById('campo-telefone'));

ligarPassoData();
ligarPassoHora();
ligarFormulario();
ligarBarra();
ligarRevelacao();

// A agenda vem do banco; até ela chegar, ninguém escolhe nada.
travarAgenda('Carregando a agenda…');
try {
  await carregarOcupacao();
  destravarAgenda();
} catch (falha) {
  travarAgenda(`${falha.message} Se preferir, chame o Marcos no WhatsApp.`);
}
