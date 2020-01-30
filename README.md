# Gnosis Liquidity Provision - Process and Implementation

## What is this task:

Will provide liquidity using two trading "strategies". The overall goal is to provide `N = 100_000` total funds 
(of each relevant token?) in `K` batches of size `N/K`. This could be once a week over `K` weeks (for example).

The step by step increase of amounts would simply correspond to post-dated deposits into the appropriate contracts.

Both of the following strategies are taken from Gnosis Liquidity Provision 
`Spreadsheet <https://docs.google.com/spreadsheets/d/10Et3GeH97ovyAyVaus04YLUFXI1uzimQCD16EkmyHLM/edit#gid=1131665963>`_ 

### Strategy 1. 


The simple bracket strategy with spread orders (0.1% and 0.4%)

All trades are indefinite and for an infinite amount:

  Address1 - (DAI, USDC, PAX) Spread of 0.1 %
  Address2 - (DAI, USDC, TUSD) Spread of 0.1 %
  Address3 - (DAI, USDC, PAX) Spread of 0.4 %
  Address4 - (DAI, USDC, TUSD) Spread of 0.4 %

Will need
  - 4 distinct funded ethereum accounts.
  - deposit funds

Use deposit and order placement scripts if possible (need safe people)
  `link to scripts <https://github.com/gnosis/dex-contracts/tree/master/scripts/stablex>`_

Example:
  Deposit Token:

  for token in relevant_token_ids:
  
    npx truffle exec scripts/stablex/deposit.js --accountId=0 --tokenId=token --amount=MAX_U128 --network $NETWORK_NAME

  Place Spread Orders:

    npx truffle exec scripts/stablex/place_spread_orders.js --tokens relevant_token_ids --accountId 0 --validFrom 4 --expiry 9999999 --sellAmount MAX_U128 --spread 0.1 --network $NETWORK_NAME

### Strategy 2; ETH-DAI bracket strategy

Based on the volatility of ETH prices, these brackets are spread orders with different centers. 
Goal is to have 9 below and 10 above the "current going rate"

Will need

- A different account for each order.
- This would be similar to the spread orders, but is **centered** around the value of Ether.

Only some of the brackets will be funded, while the other, outlying brackets, 
are meant to get their liquidity from trades if and when the price fluctuates outside of the original bracket.




## Responsibilities


### Fund provision:
 
It will be wise to get a MultiSig for future top-ups. @steven is our goto guy for the funds themselves 


### Safe Expertise and Transaction Batching: 

We were initially directed towards @richard and @alan for batching transactions with the safe. 
Can we initiate transactions with the command line with the Safe?

Richard mentioned that @denis was quite familiar with the **dutchX** bots that may be relevant. 
Of course, the strategies described above do not appear to require any sort of live services.

### Deposit and Order execution:

This would likely be anyone from @dex-core-team who is familiar with contract interactions. 
The core functionality that the administrator/orchestrator would need to make (manually) is,

1. Place Orders (on behalf of several accounts)
2. Deposit funds (when necessary)
    This could be semi-automatic (i.e. post-dated deposits, but could also be done manually)
3. Withdraw funds
4. Cancel Orders: 
    Although this was not an immediate requirement, it is assumed that this could be needed for emergency purposes.
    *Note* that the smart contract admits a vulnerability that can indefinitely postpone withdraw requests in the event that order cancellation is not an available option.

## Implementation


1. With Safe:

  To be determined. 
  Would like to speak with @denis about using the safe to interact with our contract scripts.
  May also be good to speak with @alan about batch transactions etc...

2. Without Safe:

Can interact vis CLI with `dex-contracts/scripts`. This (deployment guide)[https://github.com/gnosis/dex-contracts/wiki/Deployment-Guide] might help

Example:

- Deposit Token: The following script is convenient because both `approval` and `deposit are made at once.

```shell script
npx truffle exec scripts/stablex/deposit.js --accountId=0 --tokenId=0 --amount=30 --network $NETWORK_NAME
```
For our a list of relevant token details, see our static (whitelisted) token list at:

(Token List URL)[https://raw.githubusercontent.com/gnosis/dex-js/master/src/tokenList.json] 


- Place Spread Orders:

```shell script
npx truffle exec scripts/stablex/place_spread_orders.js --tokens 3,4,5,7 --accountId 0 --validFrom 4 --expiry 5266509 --sellAmount 50 --spread 2 --network rinkeby
```


## Finalized Decisions

### The above strategies will not require re-balancing

It is likely that the accounts implementing the strategies above will wind up with a majority of the lowest valued tokens.
It was discussed and decided that we would *not* re-balance from external exchanges. 



### Reacting to orders

After short group discussion, it seems this will boil down to a **market-order giveaway** rather than direct reaction to orders.
It might be a good idea

### Giveaway Details:

Let A, B, C, D, E be all stable coins (i.e. not `ETH`)

Place the following circle of post-dated orders with a Safe:

```.env
sell at most 1000 tokenA for at least 950 tokenB Mon. at noon (expiry ?)
sell at most 1000 tokenB for at least 950 tokenC Tue. at noon (expiry ?)
sell at most 1000 tokenC for at least 950 tokenD Wed. at noon (expiry ?)
sell at most 1000 tokenD for at least 950 tokenE Thu. at noon (expiry ?)
sell at most 1000 tokenE for at least 950 tokenA Fri. at noon (expiry ?)
```

This can be executed via the truffle scripts in `dex-contracts/scripts` as follows
```shell script
placeValidFromOrders --sellTokens 2,3,4,5 --buyTokens 3,4,5,2
```

### Public announcement of giveaway

It might not be a bad idea to put together a blog post (or public announcement) about the orders. 
Include link to the (interface)[https://dex.gnosis.io] and (telegram channel)[https://t.me/dFusionPoC]

### Uncertainties

Do we have a procedure in place for assisting to fill reasonable orders that don't have any match? 
For example, consider the following scenario:

Some market-order (i.e. selling 1000 A for 100 B) is sitting unfilled for more than 2 days. 
- Would we fill these? 
- Is this a bug in our system?


## Open Questions and TODO


### Realistic Metrics 
Could evaluate amount deposited vs amount at later date. 
May want to see if @chris to can make a dashboard for this.

### Scrap Text from meeting notes:

How is this implemented? 
Do we have the script ready ourselves (in that case generic for others to use)?
Do we need re-balancing? → tracking portfolios. → who is in charge of alerting? → are brackets “jumped”


### Landing page for simulated returns

Could show potential returns from 

- Historical data simulations (Covers strategy 1 and 2)
- Random walk simulations (possibly relevant to the price of `ETH` - strategy 2)


### TODO

- Step-by step increase of amounts addressed briefly in strategy description. 
  
  Could be done manually, or triggered via cronjob. If automated, would need to setup a kubernetes instance and possibly test first.  

- Address management (and set-up). Ideally this would be a small collection of safes with one (main) multi-sig.

Will be useful to have control of 4 + 19 accounts. Ask @denis. 
Richard mentioned a clever way for bot with limited functionality (deposit and place orders) and multi-sig to handle the processes, all other operations would require threshold signature.


- Tracking the addresses / portfolios thereof / trading history
  This boils down to having metrics and is analogous to "how do we test if this works in reality"
