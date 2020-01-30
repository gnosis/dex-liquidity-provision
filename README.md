
==========================
Gnosis Liquidity Strategy:
==========================

What is this task:
==================

Will provide liquidity using two trading "strategies". The overall goal is to provide N = 100K total funds (of each relevant token?) in K batches of size N/K. This could be once a week over K weeks (for example).

The step by step increase of amounts would simply correspond to post-dated deposits into the appropriate contracts.


Both of the following strategies are taken from Gnosis Liquidity Provision `Spreadsheet <https://docs.google.com/spreadsheets/d/10Et3GeH97ovyAyVaus04YLUFXI1uzimQCD16EkmyHLM/edit#gid=1131665963>`_ 

Strategy 1. 
-----------

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

Strategy 2. 
-----------

ETH-DAI bracket strategy

Based on the volatility of ETH prices, these brackets are spread orders with different centers. Goal is to have 9 below and 10 above the "current going rate"

Will need
  a different account for each order.
  This would be similar to the spread orders, but is centered around the value of Ether.

  Only some of the brakets will be funded, while the other, outlying brackets, are meant to get their liquidity from trades if and when the price fluctuates outside of the original bracket.




Responsibities
==============

- Fund provision: 
  @steven is our goto guy for the funds themselves
  It might be wise to get a MultiSig for future top-ups.


- Safe Expertise and Transaction Batching: 
  @richard and @alan for batching transactions with the safe.
  Can we initiate transactions with the command line with the Safe?

    Richard mentioned that @denis was quite familiar with the dutchX bots that may be relevant. 
    Of course, the strategies described above do not appear to require any sort of live services.

- Deposit and Order execution:
    this would likely be anyone from @dex-core-team who is familiar with 
    Note that, in some cases, deposits may need to be madeon a future date.


Implementation:
~~~~~~~~~~~~~~~

With Safe:

  To be determined.
  Would like to speak with @denis about using the safe to interact with our contract scripts.
  May also be good to speak with @alan about batch transactions etc...

Without Safe:

  Can interact vis CLI with `dex-contracts/scripts`
  This `deployment guide <https://github.com/gnosis/dex-contracts/wiki/Deployment-Guide>`_ might help
  Example:
    Deposit Token:
      npx truffle exec scripts/stablex/deposit.js --accountId=0 --tokenId=0 --amount=30 --network $NETWORK_NAME

    Place Spread Orders:
    npx truffle exec scripts/stablex/place_spread_orders.js --tokens 3,4,5,7 --accountId 0 --validFrom 4 --expiry 5266509 --sellAmount 50 --spread 2 --network rinkeby

Depositing tokens (OWL)

`Token List URL <https://raw.githubusercontent.com/gnosis/dex-js/master/src/tokenList.json>`_


Test if it works in reality
~~~~~~~~~~~~~~~~~~~~~~~~~~~

Metrics?

  Could evalute amount deposited vs amount at later date. May want to ask @chris to make a nice dashboard for this.



 How is this implemented? Do we have the script ready ourselves (in that case generic for others to use).
Do we need rebalancing? → tracking portfolios. → who is in charge of alerting? → are brackets “jumped”



React to orders: Process and Implementation
===========================================

After short group discussion, it seems this will boil down to a market order giveaway rather than direct reaction to orders.


A, B, C, D, E all stable coins.

Place these orders with a Safe: Need to speak with Alan
  Does it really need to be a safe?
sell at most 1000 tokenA for at least 950 tokenB Monday at noon
sell at most 1000 tokenB for at least 950 tokenC Tuesday at noon
sell at most 1000 tokenC for at least 950 tokenD Wednesday at noon
sell at most 1000 tokenD for at least 950 tokenE Thursday at noon

Write a script:
  placeValidFromOrders --sellTokens 2,3,4,5 --buyTokens 3,4,5,2 

Proceedure for assiting to fill reasonable orders that don't have any match

  Scenario: 
    Some market order (i.e. selling 1000 A for 100 B) is sitting unfilled for more than 2 days. Would we fill these? Is there a bug in the system?

Put to get a blog post (or public announcement) about the orders. Include link to the interface and telegram channel

Off topic:
  come up with a landing page to show potential returns from historical data.



TODO
----


- Step-by step increase of amounts addressed briefly in strategy description. 
  
  Could be done manually, or triggered via cronjob. If automated, would need to setup a kubernetes instance and possibly test first.  

- Address management (and set-up). Ideally this would be a small collection of safes with one (main) multi-sig.

  Will be usefull to have controll of 4 + 19 accounts. Ask @denis
  RIchard mentioned that there was a clever way for a bot with limited functionality (deposit and place orders) and multi-sig to handle the processes, all other functionality would require threshold signature.


- Tracking the addresses / portfolios thereof / trading history
  This boils down to having metrics and is analogous to "how do we test if this works in reality"


