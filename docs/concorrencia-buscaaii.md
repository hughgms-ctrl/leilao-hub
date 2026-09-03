# BuscaAii — o que aprendemos com a assinatura

Levantamento feito em 03/09/2026 gastando **2 de 10 créditos**. Os outros 8
ficaram intactos.

## Como eles cobram

| ação | custo |
|---|---|
| Buscar e obter resultados | 1 crédito |
| Desbloquear link de um leilão | 1 crédito |
| Busca sem nenhum resultado | grátis |
| Reabrir leilão já desbloqueado | grátis |
| **Paginar dentro da mesma busca** | **grátis** (medido) |

Créditos não expiram. Plano do usuário: 15, com 10 restantes no início.

**O produto é o link.** O que o crédito compra, literalmente, é a URL do
leiloeiro:

```json
POST /api/credits/unlock
{ "fonte": "https://www.megaleiloes.com.br/veiculos/carros/sp/santos/
             direitos-sobre-carro-citroen-c3-90m-tendance-2015-j127268
             ?utm_source=megaleiloes&utm_medium=link&..." }
```

Os UTM mostram que são afiliados dos leiloeiros. Nós mostramos esse link de
graça — a plataforma deles é um pedágio sobre informação pública.

## O schema deles

```
id (uuid), modelo_veiculo, marca_veiculo, tipo_leilao, tipo_produto,
imagem, observacao, featured, lance_inicial, lance_atual,
lance_inicial_segunto_lote, data_encerramento, cidade, estado,
is_recuperacao
```

Taxonomias: `tipo_leilao` = JUDICIAL | EXTRAJUDICIAL | NÃO INFORMADO.
`tipo_produto` = CAR | PICKUP_TRUCK | TRUCK | MOTORCYCLE | VAN |
HEAVY_AND_AGRICULTURAL_MACHINE | OTHERS.

Note o `lance_inicial_segunto_lote` — erro de digitação no schema deles.

### O que eles NÃO têm

Nenhum destes campos existe: **ano, quilometragem, código/preço FIPE,
placa, cor, combustível, condição do bem, score de oportunidade**.

## Qualidade dos dados deles (medido em 150 lotes)

| problema | incidência |
|---|---|
| `lance_inicial = 0` | 17 / 150 |
| sem imagem | 8 / 150 |
| não-veículo em busca de veículo (`OTHERS`) | 6 / 150 |
| sem marca | 1 / 150 |
| cidade "NÃO INFORMADO" / "SEM INFORMAÇÃO" | vários |
| lote duplicado | visto (Dodge Journey SXT idêntico 2×) |

Os valores vêm arredondados na tela ("R$ 40 mil") e no dado também são
redondos (40000, 20000) — não é só formatação, a precisão não existe.

Numa busca de **veículos** apareceram "Misturador de massa" e "Zipper Metal
p/Jaqueta". A categorização deles é furada.

## O que eles fazem melhor que nós

1. **Deságio da 2ª praça em destaque no card** (`-40%`, `-50%`). É uma
   informação que já temos e não mostramos assim.
2. **Volume**: 19 mil lotes ativos, contra ~2,6 mil nossos.
3. Produto ao redor: "Oportunidade do dia", Fórum, Área de membros, aulas
   de leilão judicial. Vendem comunidade e ensino, não só busca.
4. Quando não há foto, exibem o logo do leiloeiro em vez de espaço vazio.

## O que temos e eles não

- FIPE com match e preço de referência
- Score de oportunidade
- Ano, km, condição, combustível
- Parcelamento do art. 895 com entrada% e nº de parcelas
- Link do leiloeiro sem pedágio

## As fontes deles (o achado que vale a assinatura)

O **host da imagem revela o leiloeiro de origem sem gastar crédito**. De 150
lotes saíram 38 leiloeiros nomeados e 20 hosts anônimos de CDN.

Já coletamos: `sbwebservices` (Superbid), `megaleiloes`, `grupolance` (só
recon).

Ainda não coletamos — ordenado por incidência na amostra:

```
sfrazao.com.br              7    legisleiloes.com.br          6
bronzattoleiloes.com.br     4    mullerleiloes.com.br         4
renovarleiloes.com.br       3    nsleiloes.leilao.br          3
oroleiloes.lel.br           3    cargneluttileiloes.com.br    2
leomarkirinusleiloes.com.br 2    rechleiloes.com.br           2
clademirleiloeiro.com.br    2
danielgarcialeiloes.com.br       destakleiloes.com.br
paulobotelholeiloeiro.com.br     fidalgoleiloes.com.br
agencialeilao.com.br             regionalleiloes.com.br
chbarbosaleiloes.com.br          backleiloes.com.br
edgarcarvalholeiloeiro.com.br    italoleiloes.com
tonialleiloes.com.br             silveiraleiloes.com.br
bastonleiloes.com.br             leiloeiro.online
mgl.com.br                       sublimeleiloes.com.br
bianchileiloes.com.br            3torresleiloes.com.br
e-leiloes.com.br                 valerioiaminleiloes.com.br
suporteleiloes.com.br            vegasleiloes.com.br
glleiloes.com.br
```

Vistos por logo no card, sem host próprio: **RMoysés Leilões**, **Calil
Leilões**.

20 hosts são CDN anônimo (cloudfront, gocache, amazonaws, blob.core,
oraclecloud) e não identificam o leiloeiro pelo domínio. Um deles é
provavelmente o Freitas, que usa GoCache.

### Como reproduzir de graça

1. Uma busca (1 crédito) devolve até 200 de N resultados.
2. Paginar é grátis — dá para varrer os 200.
3. Os objetos de lote estão no fiber do React: procurar
   `memoizedProps.auction` subindo a árvore de `[class*=card]`.
4. O `imagem` de cada lote entrega o leiloeiro.

Não é preciso desbloquear nada para mapear as fontes.
