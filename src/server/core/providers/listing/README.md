# Providers de anúncio (Airbnb / Booking.com)

## Por que não há scraping aqui

Os Termos de Serviço do Airbnb e do Booking.com **proíbem coleta automatizada**
de dados dos anúncios. Além de ser uma violação contratual, qualquer scraper
quebra a cada mudança de layout e é bloqueado por proteção anti-bot.

Por isso este módulo **não faz e não deve fazer scraping**. O MVP obtém os
dados por dois caminhos legítimos:

| Provider | Como obtém o dado | Estado |
|---|---|---|
| `ManualAirbnbProvider` / `ManualBookingProvider` | O próprio usuário preenche um formulário com os dados do seu anúncio | Etapa 4 |
| `MockAirbnbProvider` / `MockBookingProvider` | Fixture embutida, marcada com `isMock: true` | Etapa 4 |
| `RealAirbnbProvider` / `RealBookingProvider` | Fonte oficial ou parceria autorizada | **Não implementado** |

## Como plugar a integração real depois

O contrato `ListingDataProvider` já isola tudo. Para adicionar a integração
oficial quando houver credencial/parceria:

1. Criar `RealAirbnbProvider implements AirbnbDataProvider` nesta pasta.
2. Registrar a opção no enum `AIRBNB_PROVIDER` em `src/server/config/env.ts`.
3. Adicionar o caso no `providers/registry.ts`.

Nenhum serviço de análise, rota de API ou componente de UI precisa mudar —
todos consomem `ListingData`, não o provider.

## Regra que não pode ser quebrada

Um provider **nunca inventa dado**. Campo ausente é `undefined`, e a análise
o reporta em `missingInfo`. Preencher uma lacuna com um valor plausível
transformaria o relatório em ficção.
