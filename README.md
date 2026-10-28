# LiteLLM Server Radar

Radar do gateway LiteLLM: varredura de modelos em tempo real, contas/chaves por
provedor e **editor da ordem de fallback** — direto do Brodrigos Dashboard.

![status](https://img.shields.io/badge/dashboard-Brodrigos-6d5efc)

## O que faz

**Aba Varredura**
- lê `/v1/models` do gateway e testa cada `model_name` com um ping de inferência;
- mostra online/offline, latência e o erro devolvido pelo provedor.

**Aba Contas & fallback**
- lista **todas as chaves do `config.yaml`**, agrupadas por chave: quando um
  provedor tem mais de uma conta para balanceamento (várias entradas com o mesmo
  `model_name`), cada chave aparece separada com a sua `api_key` mascarada;
- cada chave aceita um **e-mail da conta** que a gerou — o e-mail vale para todas
  as entradas que usam aquela chave;
- mostra a **ordem de fallback** atual, com ↑/↓ para reordenar e ✕ para tirar um
  modelo da sequência;
- chip **+ modelo** devolve à cadeia o que estava fora, e a seção *Fora da
  sequência* lista quem não participa do fallback;
- seção colapsável para o `context_window_fallbacks` (prompt grande).

## Como funciona a gravação

O editor grava **apenas** os blocos `litellm_settings.fallbacks` e
`litellm_settings.context_window_fallbacks` do `config.yaml`. O resto do arquivo
— `model_list`, chaves, comentários, `mcp_servers`, `num_retries`, `cooldown_time`
— permanece intacto.

Antes de gravar, o radar:

1. filtra nomes desconhecidos e duplicados;
2. gera um fallback em cascata (cada modelo cai para todos os seguintes da lista);
3. faz **backup** `config.yaml.bak-radar-AAAAMMDD-HHMMSS`;
4. relê o YAML e valida que a cadeia gravada é a solicitada e que nenhum outro
   bloco mudou — se a validação falhar, nada é escrito;
5. tenta reiniciar o container do Litellm (Portainer) e, sem token, avisa que o
   restart é manual.

> O gateway só passa a usar a nova ordem depois de recarregar o container.

## Rodar

```bash
# na pasta do workspace
node litellm-radar-server.js        # http://localhost:3333
```

Variáveis de ambiente:

| variável | padrão | para quê |
| --- | --- | --- |
| `RADAR_PORT` | `3333` | porta do servidor local |
| `LITELLM_HOST` / `LITELLM_PORT` | `192.168.1.130` / `4000` | gateway |
| `LITELLM_API_KEY` | lida do cofre do DSH | chave de virtual key do proxy |
| `LITELLM_CONFIG` | `//DS3622xs/docker/litellm-gateway/config.yaml` | config do gateway |
| `LITELLM_RADAR_STATE` | `litellm-radar/gateway-state.json` | e-mails e ordem local |
| `PORTAINER_TOKEN` | — | habilita restart do container pelo painel |
| `LITELLM_CONTAINER` | `litellm` | nome do container no Portainer |

> O `PORTAINER_TOKEN` pode ser definido como variável de ambiente ou adicionado ao cofre de credenciais do DSH
> (`~/.dsh/.credentials.yaml`, chave `PORTAINER_TOKEN`). Quando configurado, o botão “🔄 Reiniciar LiteLLM”
> no painel reinicia o container automaticamente via API do Portainer. Sem o token, o servidor apenas avisa que
> o restart deve ser feito manualmente no Portainer.

## Integração com o Brodrigos Dashboard

A ferramenta é descoberta por `manifest.json` + `tool.js` e apontada em
`dashboard/tools.json`:

```json
{ "paths": ["./tools", "../litellm-radar"] }
```

`dashboard/iniciar-dashboard.cmd` sobe o radar junto com o hub, então ao clicar
no item da barra lateral o servidor já está no ar.

## API

| rota | método | descrição |
| --- | --- | --- |
| `/api/scan` | GET | varredura de modelos (online/latência) |
| `/api/gateway` | GET | modelos, chaves mascaradas, e-mails, cadeia atual e pendências |
| `/api/gateway/accounts` | POST | grava e-mail/label de uma chave (`{fingerprint, email}`) |
| `/api/gateway/chain` | POST | grava ordem (`{chain: [...], ctxTargets: [...]}`) |
| `/api/gateway/reload` | POST | tenta reiniciar o container |

Chaves nunca saem do servidor: o painel recebe só o hash de 12 caracteres e a
versão mascarada (`AQ.Ab8…OSzw`).

## Testes

```bash
cd litellm-radar && npm test
```

25 testes, nenhum precisa de navegador nem do NAS:
`tests/gateway.test.js` (13) cobre derivação da cadeia, balancing de chaves,
reordenação, remoção, idempotência, validação do arquivo e backups;
`tests/tool.test.js` (12) monta a interface num DOM mínimo e clica de verdade —
ordem da lista, e-mails das contas, inclusão/exclusão e os POSTs enviados.

## Licença

MIT.
