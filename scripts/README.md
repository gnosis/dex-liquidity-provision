


## Script Usage:


### Place Orders

Requires that Master and Slave Safes are already deployed.

```js
truffle exec scripts/bracket_orders.js --targetToken=1 --stableToken=7 --targetPrice 270 --masterSafe=0xd9395aeE9141a3Efeb6d16057c8f67fBE296734c --slaves=0xb947de73ADe9aBC6D57eb34B2CC2efd41f646636,0xfA4a18c2218945bC018BF94D093BCa66c88D3c40 --network=rinkeby
```



### Transfer-Approve-Deposit

```js
truffle exec scripts/transfer_approve_deposit.js --masterSafe=0xd9395aeE9141a3Efeb6d16057c8f67fBE296734c --depositFile="./data/depositList.json" --network=rinkeby
```



