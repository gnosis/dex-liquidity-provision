# Liquidity Provision Challenge (Rinkeby)

Below is a list of accounts with ownership structure defined at the end. Account `F` (the *Fund Account*) has 100 of Token 1 and 100 of Token 2.

_Fund Account and Batch Exchange Contract_

```
F  : 0xd9395aeE9141a3Efeb6d16057c8f67fBE296734c
X  : 0xC576eA7bd102F7E476368a5E98FA455d1Ea34dE2
```

_Tokens (ERC20)_

```
T_1: 0x784b46a4331f5c7c495f296ae700652265ab2fc6
T_2: 0x0000000000085d4780b73119b644ae5ecd22b376
```

_Trader Accounts_

```
A_1: 0xb947de73ADe9aBC6D57eb34B2CC2efd41f646636
A_2: 0xfA4a18c2218945bC018BF94D093BCa66c88D3c40
```

_Ownership Structure_

Currently `F` is only owned by a single address and `F` owns all the trader accounts `A_i`, please contact ben at gnosis dot io if you would like to become an owner of `F`


**The Game**

In a single Ethereum transaction, perform any of the following “batched” transactions;

0. _Transfer-Approve-Deposit_: For each Token `T_i` and each account `A_i`, transfer `T_i` from `F` into `A_i`, approve `X` on behalf of `A_i` for `T_i` and deposit `T_i` into `X`.
1. Transfer 10 of both `T_1` and `T_2` to both trader accounts `A_1` and `A_2` from `F`
2. If possible, place an order on behalf of both `A_1` and `A_2`
3. Approve and deposit both tokens `T_i` into the exchange `X` on behalf of `A_1` and/or `A_2` (bonus points for both at the same time).