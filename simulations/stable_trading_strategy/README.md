

Data was collected from [Stable Coin Index](stab lecoinindex.io) for 1 month price history (sampled every 1 hour) of all the stable coins listed. 

We, however, are only interested in the potential gain from a trading strategy which I like to call "taking the higher ground" whenever they cross by a certain amount.

JSON take the form


```json
{
    "coin_i": {
          "prices": List[Tup(int, float)],       // representing unix-timestamp and price (in USD)
          "volumes": List[Tup(int, float)],      // representing unix-timestamp and amount? or something
          "market_caps": List[Tup(int, float)],  // representing unix-timestamp and something?
    }
}
```

Can choose from any of the following tokens,
```python
['tether', 'dai', 'trueusd', 'bitusd', 'susd', 'usd-coin', 'gemini-dollar', 'paxos-standard-token']
```




From within the playground directory run
```
python3 stable_trading_strategy/stable_trader.py
```
or alternatively, but more technicall...
```
python3 -m unittest stable_trading_strategy/test_stable_trader.py
```

and note the requirement of python 3!
