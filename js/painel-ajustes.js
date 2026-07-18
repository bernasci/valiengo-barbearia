// A aba "Ajustes" do painel — onde o Marcos edita a config que antes vivia no
// código. Por ora, o editor de serviços e planos; horários, estúdio e fotos
// entram aqui depois. Todo write passa pela sessão dele (comSessao); o banco
// só aceita porque ele consta na tabela `equipe`.

import { SessaoExpirada } from './sessao.js';
import { DIAS_SEMANA } from './config.js';
import { el, api, corpoJson } from './painel-comum.js';

let aoExpirar = () => {};

/** Chamado toda vez que a aba Ajustes abre — recarrega fresco do banco. */
export function iniciarAjustes(opcoes = {}) {
  aoExpirar = opcoes.aoExpirar || (() => {});
  render();
}

const raiz = () => document.getElementById('ajustes-conteudo');

/* ── Montagem ────────────────────────────────────────────── */

async function render() {
  const alvo = raiz();
  alvo.replaceChildren(el('p', { class: 'ajustes-carregando', text: 'Carregando…' }));

  let servicos;
  let ajustes;
  let horarios;
  try {
    const [rs, ra, rh] = await Promise.all([
      api('servicos?select=*&order=ordem.asc', { method: 'GET' }),
      api('ajustes?select=chave,valor', { method: 'GET' }),
      api('horarios?select=dia,abre,fecha&order=dia.asc,abre.asc', { method: 'GET' }),
    ]);
    servicos = await rs.json();
    ajustes = await ra.json();
    horarios = await rh.json();
  } catch (falha) {
    if (falha instanceof SessaoExpirada) return aoExpirar();
    alvo.replaceChildren(el('p', { class: 'ajustes-erro', text: falha.message }));
    return;
  }

  const estudio = (ajustes.find((a) => a.chave === 'estudio') || {}).valor || {};

  alvo.replaceChildren(
    grupoEditor('Serviços', 'servico', servicos.filter((s) => s.tipo === 'servico')),
    grupoEditor('Planos mensais', 'plano', servicos.filter((s) => s.tipo === 'plano')),
    editorEstudio(estudio),
    editorHorarios(horarios),
  );
}

function grupoEditor(titulo, tipo, itens) {
  itens.sort((a, b) => a.ordem - b.ordem);
  const lista = el('div', { class: 'edit-lista' });

  const mover = async (i, dir) => {
    const a = itens[i];
    const b = itens[i + dir];
    if (!b) return;
    try {
      await Promise.all([
        api(`servicos?id=eq.${encodeURIComponent(a.id)}`, corpoJson({ method: 'PATCH', body: JSON.stringify({ ordem: b.ordem }) })),
        api(`servicos?id=eq.${encodeURIComponent(b.id)}`, corpoJson({ method: 'PATCH', body: JSON.stringify({ ordem: a.ordem }) })),
      ]);
      render();
    } catch (falha) {
      if (falha instanceof SessaoExpirada) return aoExpirar();
      alert(falha.message);
    }
  };

  itens.forEach((item, i) => lista.append(
    itemEditor(item, { primeiro: i === 0, ultimo: i === itens.length - 1, onMover: (dir) => mover(i, dir) }),
  ));

  const adicionar = el('button', {
    class: 'ajustes-add', type: 'button',
    text: tipo === 'plano' ? '+ Adicionar plano' : '+ Adicionar serviço',
    onclick: async (e) => {
      e.target.disabled = true;
      const maxOrdem = itens.reduce((m, s) => Math.max(m, s.ordem), 0);
      const novo = {
        id: (tipo === 'plano' ? 'plano-' : 'svc-') + Date.now().toString(36),
        nome: tipo === 'plano' ? 'Novo plano' : 'Novo serviço',
        preco: 0, duracao_min: 30, tipo, ordem: maxOrdem + 10, ativo: true,
      };
      if (tipo === 'plano') novo.dias = [2, 3, 4];
      try {
        await api('servicos', corpoJson({ method: 'POST', body: JSON.stringify(novo) }));
        render();
      } catch (falha) {
        if (falha instanceof SessaoExpirada) return aoExpirar();
        e.target.disabled = false;
        alert(falha.message);
      }
    },
  });

  return el('section', { class: 'ajustes-grupo' },
    el('h2', { class: 'ajustes-grupo__titulo', text: titulo }),
    lista,
    adicionar,
  );
}

function itemEditor(item, { primeiro, ultimo, onMover }) {
  const nome = el('input', { class: 'edit-campo edit-nome', type: 'text', value: item.nome, maxLength: 80 });
  const preco = el('input', { class: 'edit-campo edit-preco', type: 'number', min: '0', step: '5', value: item.preco });
  const dur = el('select', { class: 'edit-campo edit-dur' });
  for (const m of [15, 30, 45, 60]) dur.append(el('option', { value: String(m), text: `${m} min`, selected: item.duracao_min === m }));
  const ativo = el('input', { type: 'checkbox', checked: item.ativo });
  const salvar = el('button', { class: 'edit-salvar', type: 'button', text: 'Salvar', disabled: true });
  const status = el('span', { class: 'edit-status' });

  const sujar = () => { salvar.disabled = false; status.textContent = ''; };
  [nome, preco, dur].forEach((c) => c.addEventListener('input', sujar));
  ativo.addEventListener('change', sujar);

  salvar.addEventListener('click', async () => {
    if (nome.value.trim().length < 1) { status.textContent = 'Escreva um nome.'; return; }
    salvar.disabled = true;
    status.textContent = 'Salvando…';
    try {
      await api(`servicos?id=eq.${encodeURIComponent(item.id)}`, corpoJson({
        method: 'PATCH',
        body: JSON.stringify({
          nome: nome.value.trim(),
          preco: Number(preco.value) || 0,
          duracao_min: Number(dur.value),
          ativo: ativo.checked,
        }),
      }));
      Object.assign(item, { nome: nome.value.trim(), preco: Number(preco.value) || 0, duracao_min: Number(dur.value), ativo: ativo.checked });
      status.textContent = 'Salvo ✓';
    } catch (falha) {
      if (falha instanceof SessaoExpirada) return aoExpirar();
      salvar.disabled = false;
      status.textContent = falha.message;
    }
  });

  const remover = el('button', {
    class: 'edit-remover', type: 'button', text: 'Remover',
    onclick: async () => {
      if (!confirm(`Remover "${item.nome}"? Ele some do site. Reservas já feitas não são afetadas.`)) return;
      remover.disabled = true;
      try {
        await api(`servicos?id=eq.${encodeURIComponent(item.id)}`, corpoJson({ method: 'DELETE' }));
        render();
      } catch (falha) {
        if (falha instanceof SessaoExpirada) return aoExpirar();
        remover.disabled = false;
        alert(falha.message);
      }
    },
  });

  const cima = el('button', { class: 'edit-seta', type: 'button', text: '↑', 'aria-label': 'Subir', disabled: primeiro, onclick: () => onMover(-1) });
  const baixo = el('button', { class: 'edit-seta', type: 'button', text: '↓', 'aria-label': 'Descer', disabled: ultimo, onclick: () => onMover(1) });

  const rotulo = (txt, ctrl, cls = '') =>
    el('label', { class: `edit-rotulo ${cls}`.trim() }, el('span', { text: txt }), ctrl);

  return el('div', { class: 'edit-item' },
    el('div', { class: 'edit-grade' },
      rotulo('Nome', nome, 'edit-rotulo--nome'),
      rotulo('Preço', el('div', { class: 'edit-precowrap' }, el('span', { class: 'edit-cifra', text: 'R$' }), preco)),
      rotulo('Duração', dur),
    ),
    el('div', { class: 'edit-acoes' },
      el('label', { class: 'edit-ativo' }, ativo, el('span', { text: 'No site' })),
      el('div', { class: 'edit-mover' }, cima, baixo),
      salvar, status, remover,
    ),
  );
}

/* ── Editor do estúdio (contato, endereço, pagamentos, comodidades) ──────── */

const inputTexto = (valor, placeholder = '') =>
  el('input', { class: 'edit-campo', type: 'text', value: valor ?? '', placeholder });

const linhaCampo = (rotulo, ctrl) =>
  el('label', { class: 'edit-rotulo' }, el('span', { text: rotulo }), ctrl);

const bloco = (titulo, ...kids) =>
  el('div', { class: 'estudio-bloco' }, el('p', { class: 'estudio-bloco__titulo', text: titulo }), ...kids);

/** Lista de etiquetas com remover + campo para adicionar. Devolve o nó e um obter(). */
function editorChips(valores, placeholder) {
  const lista = el('div', { class: 'chips' });
  const chip = (txt) => {
    const c = el('span', { class: 'chip' }, el('span', { class: 'chip__txt', text: txt }));
    c.append(el('button', { class: 'chip__x', type: 'button', text: '×', 'aria-label': `Remover ${txt}`, onclick: () => c.remove() }));
    return c;
  };
  (valores || []).forEach((v) => lista.append(chip(v)));

  const campo = el('input', { class: 'edit-campo chip-add', type: 'text', placeholder });
  const adicionar = () => {
    const t = campo.value.trim();
    if (t) { lista.append(chip(t)); campo.value = ''; }
    campo.focus();
  };
  campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } });

  const wrap = el('div', { class: 'chips-editor' },
    lista,
    el('div', { class: 'chip-row' }, campo, el('button', { class: 'ajustes-add', type: 'button', text: '+ Adicionar', onclick: adicionar })),
  );
  return { wrap, obter: () => [...lista.querySelectorAll('.chip__txt')].map((s) => s.textContent) };
}

function editorEstudio(estudio) {
  const end = estudio.endereco || {};
  const tel = inputTexto(estudio.telefone, '(22) 90000-0000');
  const insta = inputTexto(estudio.instagram, 'https://instagram.com/…');
  const l1 = inputTexto(end.linha1, 'Rua e número');
  const l2 = inputTexto(end.linha2, 'Bairro · Cidade/UF');
  const cep = inputTexto(end.cep, '00000-000');
  const mapa = inputTexto(end.mapa, 'Link do Google Maps');
  const pag = editorChips(estudio.pagamentos, 'ex.: PIX');
  const status = el('span', { class: 'edit-status' });

  const salvar = el('button', {
    class: 'edit-salvar', type: 'button', text: 'Salvar estúdio',
    onclick: async () => {
      salvar.disabled = true;
      status.textContent = 'Salvando…';
      const digitos = tel.value.replace(/\D/g, '');
      const whatsapp = digitos ? (digitos.startsWith('55') ? digitos : `55${digitos}`) : (estudio.whatsapp || '');
      // Preserva os campos de marca (nome, lema, pilares…) que este editor não mexe.
      const novo = {
        ...estudio,
        telefone: tel.value.trim(),
        whatsapp,
        instagram: insta.value.trim(),
        endereco: { ...end, linha1: l1.value.trim(), linha2: l2.value.trim(), cep: cep.value.trim(), mapa: mapa.value.trim() },
        pagamentos: pag.obter(),
        // comodidades ficam preservadas via ...estudio (não são mais exibidas no site)
      };
      try {
        await api('ajustes?chave=eq.estudio', corpoJson({
          method: 'PATCH',
          body: JSON.stringify({ valor: novo, atualizado_em: new Date().toISOString() }),
        }));
        status.textContent = 'Salvo ✓';
      } catch (falha) {
        if (falha instanceof SessaoExpirada) return aoExpirar();
        status.textContent = falha.message;
      } finally {
        salvar.disabled = false;
      }
    },
  });

  return el('section', { class: 'ajustes-grupo' },
    el('h2', { class: 'ajustes-grupo__titulo', text: 'Estúdio' }),
    el('div', { class: 'estudio-form' },
      bloco('Contato', linhaCampo('Telefone (WhatsApp)', tel), linhaCampo('Instagram', insta)),
      bloco('Endereço', linhaCampo('Linha 1', l1), linhaCampo('Linha 2', l2), linhaCampo('CEP', cep), linhaCampo('Link do mapa', mapa)),
      bloco('Formas de pagamento', pag.wrap),
    ),
    el('div', { class: 'edit-acoes' }, salvar, status),
  );
}

/* ── Editor de horários ─────────────────────────────────── */

// Cada linha é um turno (abre–fecha). Dia sem turno = fechado. Ao salvar, a
// grade inteira é reenviada e a função salvar_horarios troca tudo de uma vez.
// Snap de 30 min nos campos de hora casa com a grade que o site desenha e que
// a regra de reserva valida (reserva_valida exige início em múltiplo do passo).

function turnoRow(abre, fecha, aoRemover) {
  const inpAbre = el('input', { class: 'edit-campo hora-abre', type: 'time', step: '1800', value: abre || '' });
  const inpFecha = el('input', { class: 'edit-campo hora-fecha', type: 'time', step: '1800', value: fecha || '' });
  const remover = el('button', { class: 'turno-x', type: 'button', text: '×', 'aria-label': 'Remover turno', onclick: () => aoRemover() });
  return el('div', { class: 'turno-row' }, inpAbre, el('span', { class: 'turno-tra', text: '–' }), inpFecha, remover);
}

function editorHorarios(horarios) {
  const porDia = {};
  for (const t of horarios) (porDia[t.dia] ??= []).push(t);
  const status = el('span', { class: 'edit-status' });

  const cards = DIAS_SEMANA.map((nome, dia) => {
    const turnos = el('div', { class: 'turnos' });
    const fechado = el('p', { class: 'dia-fechado', text: 'Fechado' });

    const sincronizar = () => { fechado.hidden = turnos.children.length > 0; };
    const addTurno = (abre = '09:00', fecha = '12:00') => {
      let row;
      const remover = () => { row.remove(); sincronizar(); };
      row = turnoRow(abre, fecha, remover);
      turnos.append(row);
      sincronizar();
    };

    (porDia[dia] || []).forEach((t) => addTurno(t.abre.slice(0, 5), t.fecha.slice(0, 5)));
    sincronizar();

    return el('div', { class: 'dia-card', 'data-dia': String(dia) },
      el('div', { class: 'dia-card__topo' },
        el('span', { class: 'dia-card__nome', text: nome }),
        el('button', { class: 'dia-add', type: 'button', text: '+ turno', onclick: () => addTurno() }),
      ),
      turnos,
      fechado,
    );
  });

  const container = el('div', { class: 'horarios-form' }, ...cards);

  const salvar = el('button', {
    class: 'edit-salvar', type: 'button', text: 'Salvar horários',
    onclick: async () => {
      const turnos = [];
      let erro = null;
      container.querySelectorAll('.dia-card').forEach((card) => {
        const dia = Number(card.dataset.dia);
        [...card.querySelectorAll('.turno-row')].forEach((row, i) => {
          const abre = row.querySelector('.hora-abre').value;
          const fecha = row.querySelector('.hora-fecha').value;
          if (!abre || !fecha) { erro = erro || `${DIAS_SEMANA[dia]}: preencha início e fim do turno.`; return; }
          if (fecha <= abre) { erro = erro || `${DIAS_SEMANA[dia]}: o fim tem que ser depois do início.`; return; }
          turnos.push({ dia, abre, fecha, ordem: i });
        });
      });
      if (erro) { status.textContent = erro; return; }

      salvar.disabled = true;
      status.textContent = 'Salvando…';
      try {
        await api('rpc/salvar_horarios', corpoJson({ method: 'POST', body: JSON.stringify({ p_turnos: turnos }) }));
        status.textContent = 'Salvo ✓';
      } catch (falha) {
        if (falha instanceof SessaoExpirada) return aoExpirar();
        status.textContent = falha.message;
      } finally {
        salvar.disabled = false;
      }
    },
  });

  return el('section', { class: 'ajustes-grupo' },
    el('h2', { class: 'ajustes-grupo__titulo', text: 'Horários' }),
    el('p', { class: 'ajustes-nota', text: 'Dia sem turno fica fechado. Os horários batem com a grade de agendamento — mudou aqui, muda no site e no que o cliente pode marcar.' }),
    container,
    el('div', { class: 'edit-acoes' }, salvar, status),
  );
}
