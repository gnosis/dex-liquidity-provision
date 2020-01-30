Gnosis's Giveaways
==================

The plan
--------

### Idea
Set up a list of planned orders with prices below market values. Advertise this "giveaway". Let users match orders to their advantage, while Gnosis takes a loss.

### Objective
Make developers and traders aware of Dfusion and make them become a bit familiar with the protocol. In this way, Dfusion may be included into their other projects without the extra friction of having to learn a new tool.

### Disadvantages
- Users might think we "cheat", since even if we were to offer 1 ETH for 1 DAI we could technically put up a buy order at a reasonable price and have no losses but the transaction fees.
- Orders would probably match with our own bracket trading strategies.
- If giveaways stay up for too long, it looks like people are not interested in the protocol.

### Strategy
Divide orders in batches, one each month, for a total of three batches. Send all orders of a batch at its start, as well as all funds.
We are then able change the size of the giveaway depending of the popularity of the protocol to curtail losses. (If the protocol becomes popular, even giving away 1 ETH for 1 DAI should be safe, since market forces would naturally push up the price.)

### Managing funds
Two options.
1. Using one dedicated address for every giveaway.  
    Advantages:
    + It lets every user understand at a glance (e.g. using Etherscan) whether the funds of the giveaway is still up for the take.
    + Useful to us to keep track of each giveaway manually and compute losses.  

    Disadvantages:
    - More complexity: we first need to collect all funds from Gnosis to a single dedicated multisig address, and then deploy all orders to the network. All these giveaway addresses should be multisig, transactions require thus many signatures and back and forth.
    - Many transactions required, might be expensive. (Yet likely much less that the total amount in the giveaways.)
  Question: can we save some gas by having Gnosis Safe control these addresses?
2. Using a single address.  
Advantages:
    + We should be able to use the Safe to save on gas.
    + Easier key management, meaning human error is less likely.

    Disadvantages:
    - Single point of failure: if an order is erroneous, then it influences all other giveaways.
    - We cannot have orders with unlimited amounts.
    - No easy way for the user to tell if a specific giveaway is not available anymore.

In both cases it's reasonable to send the transactions with a manual process using a multisig wallet, manually checking all transactions against some authoritative source. (We probably trust Google Drive for that?)

Revocation: if something goes wrong, everybody involved from Gnosis should be able without further permission to instantly (1) cancel all orders (2) retrieve all remaining funds to some predetermined address, even if the wallet is multisig.
Question: is this possible with the safe to for example pre-multisign an emergency "mop all out" transaction? Does it matter if we use single or multiple addresses? If there is no way to do that, do we want an ad hoc contract that does that? If not, do we want to not have easy revocation or we'd rather not have multisig?

### Dedicated giveaways
We can reward users for doing actions other than exchanging standard tokens.
1. prize for normal trade: create ad hoc token AHT1 that can be redeemed for free, then make a sell order that sells e.g. 10000 AHT1 for 100 DAI.
2. prize for adding a token to the exchange: the user must create an ad hoc token AHT2 with 10^6 ATH2 available. Gnosis creates a contract with a function taking an index i and the AHT2 contract address, tries to withdraw 10^6 tokens and checks whether the Dfusion token at index i corresponds indeed to the address given, and if everything is successful the user receives 100 DAI.
3. prize for submitting a solution. Create yet another token AHT3 whose orders are ignored by the solver. The token is set up to give free tokens on request. Set up a trade for AHT3 in exchange for 100 DAI.
(Notably absent: prize for ring trade. I couldn't come up with a good idea for it.)
@Ben: OWL needs to be part of the loop somewhere. I didn't consider that when coming up with these examples. Can this be a problem? Can this be made into an extra prize?

Batch structure
---------------

Batch 1 should have mostly one-time good trades.
From batch 2 there should be more regular, smaller good trades.
The goal is to either have users leave open orders on Dfusion (probably at a not-too-bad price, otherwise other people would later make better offers) or make them automate the sending of an order (also good, hopefully these people will include the code they create for this on future projects).
The following tentative batches assume that the giveaway has gained traction in the previous month(s), otherwise amounts should be reduced and the orders should remain simple, similarly to batch 1.

### Coins used
- Stablecoins A, B, C, D, E (DAI, Gemini, Paxos, USD Coin, TrueUSD, Tether, ...?)
- WETH
- GNO
- ?

### Batches
#### Batch 1
- The dedicated giveaways from [here](#dedicated-giveaways) (from day 0 to day 30)
- Sell 10 GNO for 1 OWL (from day 0 to day 14)
- Sell 1 WETH for 1 GNO (from day 7 to day 21)
- Sell 100 OWL for 1 GNO (from day 14 to day 28)
- Sell 5 token A, B, C, D, E, each for 1 OWL (from day 21 to day 30)
- Sell 10 token A, B, C, D, E, each for 1 OWL (from day 28 to day 30)

Worst case giveaway: 743$ = 3\*100 + 10\*13 + 1\*175 + 100\*1 + 5\*5\*1 + 5\*10\*1 - (1+13+13+5+5)

#### Batch 2

- Sell 1 WETH for 10 A (from day 1 to day 7)
- Sell 100 A, B, C, D, E for 80 B, C, D, E, A (on day 8, 9, 10, 11, 12)
- Sell 2 OWL for 1 A, B, C, D, E  (on day 13, 14, 15, 16, 17)
- Sell 20 GNO for 1 WETH (on day 17 to day 21)
- Sell 100 A, B, C, D for 95 B, C, D, E (on day 22)
  (This creates a loop that should be closed by a user to get 3*4=12 free USD)


Worst case giveaway: 495$ = 1\*175 + 5\*100\*1 + 5\*1\*13 + 20\*13 + 4\*100\*1 - (10+400+5+175+388)

#### Batch 3
- Sell 1000 A, B, C, D, E for 950 B, C, D, E, A (at 12am on day 1, 2, 3, 4, 5)



