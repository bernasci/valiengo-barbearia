# Valiengo · Estúdio Barbearia

Site da barbearia do Marcos, em São João da Barra/RJ. HTML, CSS e JavaScript
puros — sem build, sem dependências.

```
index.html            o site do cliente
agenda.html           o painel do Marcos (login + agenda do dia)
css/styles.css        identidade visual
css/painel.css        o painel do Marcos
js/config.js          serviços, preços, horários e contato  ← mexa aqui no dia a dia
js/agenda.js          conversa com o banco (Supabase)
js/sessao.js          login e tokens do Marcos
js/app.js             montagem da página e fluxo de reserva
js/painel.js          a agenda do dia
supabase/schema.sql   referência do banco que já está no ar
```

## Rodar na sua máquina

O site usa módulos ES, que o navegador recusa a carregar via `file://`. Ele
precisa ser servido por HTTP. Sem Node nem Python instalados, o PowerShell
resolve:

```powershell
# a partir da pasta do projeto
$l = New-Object System.Net.HttpListener
# … ou simplesmente use a extensão "Live Server" do VS Code
```

Mais simples: instale o [Node](https://nodejs.org) e rode `npx serve .`, ou abra
a pasta no VS Code e clique em **Go Live**.

## Mudar preço, serviço ou horário

Tudo vive em `js/config.js`. Um preço novo em `SERVICOS` aparece na tabela, nas
fichas de agendamento e no resumo da reserva ao mesmo tempo — não há duplicata
para esquecer.

- `duracao` é em minutos e controla quantos blocos de 30 min o horário ocupa.
  Um serviço de 45 min reserva 14:00 **e** 14:30.
- `HORARIOS` usa 0 = domingo … 6 = sábado. Dia ausente da lista = fechado.
- `dias: [2, 3, 4]` num plano o restringe a terça, quarta e quinta.

## Celular

O site é feito para o celular primeiro — é de onde vem quase todo o tráfego, via
link da bio do Instagram. Decisões que dependem disso e não devem ser desfeitas
sem pensar:

- **`fieldset { min-inline-size: 0 }`**, em `styles.css`. O fieldset tem um
  `min-width: min-content` embutido que ignora o pai. Sem essa linha, a régua de
  dias estica o formulário para 1197px numa tela de 375px.
- **Campos com fonte de 16px ou mais.** Abaixo disso, o Safari do iPhone dá zoom
  sozinho ao focar o campo e desalinha a página.
- **Alvos de toque de no mínimo 44px**, o mínimo confortável para o dedo.
- **A barra fixa de agendar** (`.barra`) só aparece no meio da página. Na capa e
  na própria agenda ela seria redundante, já que o botão está ali.
- **`env(safe-area-inset-bottom)`** mantém a barra acima da faixa de gestos do
  iPhone.
- **Pesos de fonte explícitos.** Trocar de família sem fixar o peso faz herdar o
  `300` do `body`, que nenhuma dessas fontes carrega — o navegador então falsifica
  o traço. Se acrescentar um peso no CSS, acrescente também na URL do Google
  Fonts, no `index.html`.

## A agenda (Supabase)

As reservas gravam num Postgres no projeto **Valiengo Barbearia**
(`lbozziokrhdpwevwpyhf`, região de São Paulo). O `js/agenda.js` fala com ele por
`fetch` na API REST — sem biblioteca, para não custar ~40 KB de download no
celular do cliente.

**A chave em `js/config.js` é pública de propósito.** Ela vai no HTML, à vista
de qualquer um, e não é um segredo. Quem protege os dados é o banco. A chave
secreta (`service_role`) nunca pode entrar neste projeto.

O princípio que governa o desenho: **o navegador só pede, o Postgres decide.**
Como qualquer pessoa pode pegar a chave e chamar a API direto, sem passar pela
tela, toda regra que importa está no banco (veja `supabase/schema.sql`):

- **Nenhuma reserva encosta em outra.** Uma restrição de exclusão sobre o
  intervalo de tempo. Um corte de 45 min às 14:00 bloqueia 14:30 sozinho — e é
  por isso que um `UNIQUE (data, inicio)` *não* serviria: os inícios são
  diferentes, e o `UNIQUE` deixaria a sobreposição passar.
- **A tabela é cega para o público.** Não existe policy de `SELECT`. O site
  descobre os horários ocupados pela função `horarios_ocupados()`, que devolve
  só `data`, `inicio` e `duracao_min` — nome e telefone de cliente nunca saem do
  banco.
- **A política de inserção recusa** data no passado, domingo e segunda, horário
  fora dos turnos, duração acima de 60 min (senão alguém reserva o dia inteiro),
  horário fora da grade de 30 min e telefone inválido.

Se um cliente perder a corrida por um horário, o banco recusa e a tela mostra
"Esse horário acabou de ser preenchido", recarregando a grade sozinha.

### Cuidado ao mexer

**O horário de atendimento vive em dois lugares:** `js/config.js` (que desenha a
tela) e a policy no banco (que decide o que entra). É duplicação consciente —
mexeu num, mexa no outro, senão o cliente escolhe um horário na tela e leva uma
recusa sem entender por quê.

## O painel do Marcos (`agenda.html`)

Uma página à parte, fora do site do cliente: ele entra com e-mail e senha, vê os
horários do dia, anda entre os dias, chama o cliente no WhatsApp com um toque e
cancela um horário quando precisa.

**Estar logado não basta para ver a agenda.** O Supabase deixa qualquer um se
cadastrar, então o acesso é amarrado à tabela `equipe`: quem não está nela loga
e não vê absolutamente nada. É de propósito — sem isso, um estranho criaria uma
conta e leria o telefone de todos os clientes.

### Como liberar o acesso do Marcos

1. No painel do Supabase, vá em **Authentication → Users → Add user** e crie o
   usuário dele com e-mail e senha. (Essa senha é dele; ela não entra em nenhum
   arquivo deste projeto.)
2. Rode isto no **SQL Editor**, trocando o e-mail:

   ```sql
   insert into public.equipe (user_id, nome)
   select id, 'Marcos' from auth.users where email = 'EMAIL-DO-MARCOS';
   ```

3. Abra `agenda.html` no celular dele e entre. Vale salvar na tela de início.

Se ele trocar de celular ou perder o aparelho, dá para derrubar a sessão em
**Authentication → Users**, sem mexer em código.

## O que ainda falta

1. **O Marcos não é avisado de reserva nova.** Ele só descobre abrindo a agenda,
   ou pelo WhatsApp que o cliente manda na tela de confirmação. Um disparo
   automático a cada reserva resolveria.
2. **O cliente não é avisado do cancelamento.** Quando o Marcos cancela, a tela
   deixa claro que ele precisa ligar. É manual de propósito, mas dá para
   automatizar.
3. **O cliente não consegue cancelar sozinho** — só o Marcos.
4. **Nada impede spam.** Um robô pode encher a agenda de reservas falsas dentro
   das regras. Enquanto o movimento for de bairro, o risco é baixo; se acontecer,
   dá para exigir confirmação por WhatsApp antes de firmar o horário.

## Publicar

Como é um site estático, sobe em qualquer lugar de graça: arraste a pasta no
[Netlify Drop](https://app.netlify.com/drop), ou conecte o repositório na
[Vercel](https://vercel.com). Depois é só apontar o link da bio do Instagram
para o endereço novo.

## Pendências de conteúdo

- **Fotos.** A galeria em "O estúdio" tem quatro molduras vazias (fachada,
  cadeira, Marcos, um corte). Coloque as imagens em `img/` e troque as molduras
  em `pintarEstudio()`, em `js/app.js`.
- **Estacionamento.** As comodidades listam "Estacionamento", mas no AppBarber o
  ícone aparece riscado. Confirme com o Marcos; se não houver, remova a linha em
  `js/config.js`.
