-- Banco da agenda do Valiengo — já aplicado no projeto "Valiengo Barbearia"
-- (lbozziokrhdpwevwpyhf, região sa-east-1). Este arquivo é a referência do que
-- está lá; recriar do zero é só rodar tudo na ordem.
--
-- A ideia central: o site é público e a chave dele vai no HTML, à vista de
-- todos. Portanto quem manda é o banco, nunca o JavaScript. O navegador só
-- pede; o Postgres decide.

create extension if not exists btree_gist with schema extensions;

-- ── A tabela ────────────────────────────────────────────────────────────────

create table public.agendamentos (
  id           uuid primary key default gen_random_uuid(),
  servico_id   text        not null,
  data         date        not null,
  inicio       time        not null,
  duracao_min  int         not null,
  nome         text        not null,
  telefone     text        not null,
  criado_em    timestamptz not null default now(),

  -- Intervalo que a cadeira fica ocupada, derivado dos campos acima.
  -- `timestamp` sem fuso: a barbearia vive num fuso só e o Brasil não tem
  -- mais horário de verão desde 2019.
  periodo tsrange generated always as (
    tsrange(data + inicio, data + inicio + make_interval(mins => duracao_min))
  ) stored,

  constraint duracao_plausivel   check (duracao_min between 5 and 240),
  constraint nome_preenchido     check (length(btrim(nome)) > 0),
  constraint telefone_preenchido check (length(btrim(telefone)) > 0),

  -- Nenhuma reserva pode encostar em outra. Um corte de 45 min às 14:00
  -- bloqueia 14:30 sozinho — coisa que um UNIQUE (data, inicio) deixaria
  -- passar, porque os inícios são diferentes.
  constraint sem_sobreposicao exclude using gist (periodo with &&)
);

create index agendamentos_data_idx on public.agendamentos (data);

-- ── Quem pode o quê ─────────────────────────────────────────────────────────

alter table public.agendamentos enable row level security;

-- Repare que NÃO existe policy de SELECT. A tabela é cega para o público: sem
-- isso, qualquer um pegaria a chave no HTML e baixaria o nome e o telefone de
-- todos os clientes do Marcos.
create policy "cliente marca horario"
  on public.agendamentos
  for insert
  to anon
  with check (
    data >= current_date
    and data <= current_date + 90

    -- terça (2) a sábado (6)
    and extract(dow from data) between 2 and 6

    -- o serviço mais longo tem 45 min; sem teto, alguém reservaria o dia todo
    and duracao_min between 15 and 60

    -- a grade é de 30 em 30; sem isto alguém marca 14:07 e fragmenta o dia
    and date_part('minute', inicio) in (0, 30)
    and date_part('second', inicio) = 0

    -- tem que caber inteiro dentro de um dos dois turnos
    and (
      (inicio >= time '09:30' and (inicio + make_interval(mins => duracao_min)) <= time '12:30')
      or
      (inicio >= time '14:00' and (inicio + make_interval(mins => duracao_min)) <= time '20:00')
    )

    and length(btrim(nome)) between 2 and 80
    and length(regexp_replace(telefone, '\D', '', 'g')) between 10 and 11
    and servico_id ~ '^[a-z0-9-]{2,40}$'
  );

-- ── A única porta de leitura ────────────────────────────────────────────────

-- Devolve de propósito só o intervalo ocupado, nunca quem o ocupa.
create function public.horarios_ocupados(de date, ate date)
returns table (data date, inicio time, duracao_min int)
language sql
security definer
stable
set search_path = public
as $$
  select a.data, a.inicio, a.duracao_min
  from public.agendamentos a
  where a.data between de and ate
  order by a.data, a.inicio;
$$;

revoke all on function public.horarios_ocupados(date, date) from public;
grant execute on function public.horarios_ocupados(date, date) to anon;

-- O linter do Supabase avisa que uma função SECURITY DEFINER é executável pelo
-- público. Aqui é de propósito: é a porta que entrega disponibilidade sem dado
-- pessoal, com search_path fixo e devolvendo só colunas não sensíveis.

-- ── O painel do Marcos (agenda.html) ────────────────────────────────────────

-- Quem trabalha na barbearia. Estar logado NÃO basta para ver a agenda: o
-- Supabase deixa qualquer um se cadastrar, então sem esta lista um estranho
-- criaria uma conta e leria o telefone de todos os clientes.
create table public.equipe (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  nome      text not null,
  criado_em timestamptz not null default now()
);

alter table public.equipe enable row level security;

-- SECURITY DEFINER de propósito: sem isto, checar a equipe dentro de uma
-- policy da própria equipe entra em recursão infinita.
create function public.e_da_equipe()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.equipe where user_id = auth.uid());
$$;

-- O `revoke from public` não basta: o Supabase concede execute ao papel `anon`
-- explicitamente por padrão nas funções do schema public, e esse grant sobrevive
-- ao revoke acima. Por isso o revoke nominal ao anon logo abaixo.
revoke all on function public.e_da_equipe() from public;
revoke execute on function public.e_da_equipe() from anon;
grant execute on function public.e_da_equipe() to authenticated;

create policy "cada um se ve na equipe"
  on public.equipe for select to authenticated
  using (user_id = auth.uid());

create policy "equipe le a agenda"
  on public.agendamentos for select to authenticated
  using (public.e_da_equipe());

create policy "equipe cancela horario"
  on public.agendamentos for delete to authenticated
  using (public.e_da_equipe());

-- O Marcos também marca pelo balcão, sem as amarras do site público (encaixe
-- fora do horário, cliente sem telefone, etc.). A agenda é dele.
create policy "equipe marca no balcao"
  on public.agendamentos for insert to authenticated
  with check (public.e_da_equipe());

-- Depois de criar o usuário do Marcos no painel do Supabase (Authentication →
-- Add user), libere o acesso dele com:
--
--   insert into public.equipe (user_id, nome)
--   select id, 'Marcos' from auth.users where email = 'EMAIL-DO-MARCOS';
--
-- Sem essa linha ele loga mas não vê nada — de propósito.
