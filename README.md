# Gnosis Liquidity Provision - Process and Implementation


Will provide liquidity using two trading "strategies". The overall goal is to provide `N = 100_000` total funds 
(of each relevant token?) in `K` batches of size `N/K`. This could be once a week over `K` weeks (for example).

The step by step increase of amounts would simply correspond to post-dated deposits into the appropriate contracts.

## Provision Descriptions

Both of the following strategies are taken from Gnosis Liquidity Provision 
[Spreadsheet](https://docs.google.com/spreadsheets/d/10Et3GeH97ovyAyVaus04YLUFXI1uzimQCD16EkmyHLM/edit#gid=1131665963)

### Strategy 1: Standing Spread Orders


The simple bracket strategy with spread orders (0.1% and 0.4%)

All trades are indefinite and for an infinite amount:

- Address1 - (DAI, USDC, PAX) Spread of 0.1 %
- Address2 - (DAI, USDC, TUSD) Spread of 0.1 %
- Address3 - (DAI, USDC, PAX) Spread of 0.4 %
- Address4 - (DAI, USDC, TUSD) Spread of 0.4 %

Will need
  - 4 distinct funded ethereum accounts.
  - deposit funds

If possible with the safe and CPK, could use existing deposit and order placement [scripts](https://github.com/gnosis/dex-contracts/tree/master/scripts/stablex)

**Example:**

1. Deposit Token: 
  
```
for t_id in relevant_token_ids:
	for a_id in relevant_unlocked_accounts:
  		npx truffle exec scripts/stablex/deposit.js \
  			--accountId a_id \
	  		--tokenId t_id \
  			--amount $K \ 
  			--network $NETWORK_NAME
```

2. Place Spread Orders:

```
for s in spreads:
	for a_id in relevant_unlocked_accounts:
		npx truffle exec scripts/stablex/place_spread_orders.js \
			--tokens relevant_token_ids \
			--accountId a_id \
			--validFrom 4 \
			--expiry &MAX_U128 \
			--sellAmount &INFINITY \
			--spread s \
			--network $NETWORK_NAME
```

### Strategy 2: ETH-DAI bracketing

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


1. Using the Gnosis Safe:

  To be determined. 
  Would like to speak with @denis about using the safe to interact with our contract scripts.
  May also be good to speak with @alan about batch transactions etc...

2. Without Safe:

Can interact vis CLI with `dex-contracts/scripts`. This (deployment guide)[https://github.com/gnosis/dex-contracts/wiki/Deployment-Guide] might help

**Example:**

- Deposit Token: The following script is convenient because both `approval` and `deposit` are made at once.

```shell script
npx truffle exec scripts/stablex/deposit.js \
	--accountId=0 \
	--tokenId=0 \
	--amount=30 \
	--network $NETWORK_NAME
```
For our a list of relevant token details, see our static (whitelisted) token list at:

[Token List URL](https://raw.githubusercontent.com/gnosis/dex-js/master/src/tokenList.json)


- Place Spread Orders:

```shell script
npx truffle exec scripts/stablex/place_spread_orders.js \
	--tokens 3,4,5,7 \
	--accountId 0 \
	--validFrom 4 \
	--expiry 5266509 \
	--sellAmount 50 \
	--spread 2 \
	--network rinkeby
```


## Finalized Decisions

### The above strategies will not require re-balancing

It is likely that the accounts implementing the strategies above will wind up with a majority of the lowest valued tokens.
It was discussed and decided that we would *not* re-balance from external exchanges. 



### Reacting to orders (Giveaways)

After short group discussion, it seems this will boil down to a **market-order giveaway** rather than direct reaction to orders.
It might be a good idea

#### Giveaway Details:

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

```
placeValidFromOrders --sellTokens 2,3,4,5 --buyTokens 3,4,5,2 --validFroms 10,20,30 ...
```

##### Public announcement

It might not be a bad idea to put together a blog post (or public announcement) about the orders. 
Include link to the (interface)[https://dex.gnosis.io] and (telegram channel)[https://t.me/dFusionPoC]

##### Uncertainties

Proceedure for assisting in fulfillment of reasonable orders that don't have any match? 

**Example**

Some market-order (i.e. selling 1000 A for 100 B) is sitting unfilled for more than 2 days.
- Would we fill these? 
- Is this a bug in our system?
- Should we expect that there are enough spread orders covering this?


## Points of Contact

- **Alan** for [Contract Proxy Kit](https://github.com/gnosis/contract-proxy-kit)
- **Alex** for [Contract Integration](https://github.com/gnosis/dex-contracts-integration-example)
- **Denis** for experience with asset management and bots for DutchX
- **Lukas** for [Gnosis Multisig](https://safe.gnosis.io/multisig/) onboarding guidance
- **Richard** for overall Safe expertise
- **Steven** for fund allocation

## Open Questions & Tasks


### Depositing Process
- What are the values for N and K?
- Are we planning to fund 100K of each relevant token or total?
- How often do we deposit new funds into each account with open orders?
- Should the depositing be done on a schedule or manually?
	- *Pro-Manual*: If only 10 times over 10 weeks manual would be easiest. Less infrastructure, less testing.
	- *Con-Manual*: Could be prone to human error
		- Transfering 10K to wrong address
	- *Pro-Automatic:* Reusability for external providers.
	- *Con-Automatic:* Would require more development and will take longer (at first)

### Realistic Metrics 
Could evaluate amount deposited vs amount at later date. 
May want to see if @chris to can make a dashboard for this.

### Landing page for simulated returns

Could show potential returns from 

- Historical data simulations (Covers strategy 1 and 2)
- Random walk simulations (possibly relevant to the price of `ETH` - strategy 2)

### Address/Asset Management (Gnosis Multisig)

- There will be enough funds that we will want to have them stored in a multisig with 7 owners and a threshold of 2 or 3.

- Will require that the multi-sig has control over 4 (strategy 1) + 19 (strategy 2) accounts.

- Richard mentioned a clever way for bot with limited functionality (deposit and place orders) and multi-sig to handle the processes, all other operations would require threshold signature.



### TODO

- Complete pseudo code for Stategy 2
- Complete pseudo code for scheduled giveaway orders
- Expiry dates on giveaway orders?
- Tracking the addresses / portfolios thereof / trading history
  This boils down to having metrics and is analogous to "how do we test if this works in reality"


### Scrap Text from meeting notes:

How is this implemented? 
Do we have the script ready ourselves (in that case generic for others to use)?
Do we need re-balancing? → tracking portfolios. → who is in charge of alerting? → are brackets “jumped”
