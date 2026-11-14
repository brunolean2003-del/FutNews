# Apito

Agregador de notícias das Séries A e B do Campeonato Brasileiro. Reúne manchetes de
ge, Lance!, ESPN, Gazeta Esportiva e Bolavip e organiza por série e por clube.
Cada notícia leva ao site de origem.

## Rodar localmente

Precisa apenas do Node 18 ou mais novo. Não há dependências para instalar.

```bash
npm start
```

Abra http://localhost:3000.

## Como funciona

| Arquivo | Papel |
|---|---|
| `server.js` | Servidor HTTP, coleta a cada 10 min, cache e API (`/api/news`) |
| `src/sources.js` | Leitura de cada fonte (RSS, sitemap ou API) |
| `src/clubs.js` | Lista dos 40 clubes e as regras para reconhecê-los |
| `src/classify.js` | Decide série e clube de cada notícia |
| `public/` | Interface (HTML, CSS e JS puros) |

Na virada da temporada, mova os clubes entre as séries em `src/clubs.js`.

## Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `3000` | Porta do servidor (a hospedagem costuma definir sozinha) |
| `DATA_DIR` | `./data` | Onde guardar o cache de notícias; aponte para um disco persistente se houver |

Sem disco persistente o site funciona normalmente: ao reiniciar ele recoleta tudo
(cerca de 20 segundos) e só perde o histórico do Lance!, que publica apenas as notícias do dia.

## Publicar

O Apito é um processo Node que fica ligado, então precisa de uma hospedagem de
aplicação (não serve hospedagem só de arquivos estáticos).

### Render (plano gratuito)

1. Suba este projeto para um repositório no GitHub.
2. No Render, escolha **New → Blueprint** e selecione o repositório. O `render.yaml` já configura tudo.
3. Ao terminar, o site fica em `https://<nome>.onrender.com`.

No plano gratuito o serviço dorme após 15 minutos sem visitas; a primeira visita
depois disso demora perto de um minuto.

### Qualquer hospedagem com Docker (Fly.io, Railway, VPS)

```bash
docker build -t apito .
```

```bash
docker run -p 3000:3000 apito
```

Verificação de saúde: `GET /healthz`.

## Antes de divulgar

- O site mostra manchete, resumo curto e miniatura de cada veículo, sempre com link
  para a matéria original. As miniaturas são carregadas direto dos servidores das fontes.
  Se for monetizar ou ganhar audiência, vale conferir os termos de uso de cada veículo.
- A ESPN é lida por uma API pública não documentada e o Lance! pelo sitemap de notícias;
  ambos podem mudar sem aviso. Quando uma fonte falha, o rodapé mostra "Indisponível".
