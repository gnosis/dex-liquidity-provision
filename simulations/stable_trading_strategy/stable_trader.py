import json
from typing import List, Tuple


def basic_high_ground_strategy(
        filepath: str,
        token_1: str,
        token_2: str,
        # Next few values should be percentages!
        maker_rate: float,
        dfusion_fee: float,
        other_exchange_fee: float,
) -> List[float]:
    print(
        "High-ground strategy for {}-{} with parameters:\n"
        "maker rate  = {}%\n"
        "dfusion fee = {}%\n"
        "other fee   = {}%\n".format(
            token_1, token_2, dfusion_fee, maker_rate, other_exchange_fee
        )
    )

    with open(filepath, 'r') as file:
        data = json.loads(file.read())

    t1_timestamps, t1_prices = list(zip(*data[token_1]['prices']))
    t2_timestamps, t2_prices = list(zip(*data[token_2]['prices']))

    # Ensure validity of data
    assert len(t1_prices) == len(t1_prices), "inconsistent price data!"
    assert t1_timestamps == t2_timestamps, "timestamps don't line up!"

    # Assuming there is a market maker who is always willing to pay 0.99 for either token and sell at a rate of 1.01
    trade_threshold = dfusion_fee + maker_rate + other_exchange_fee
    assert 0 < trade_threshold < 100, "invalid trade threshold {}".format(trade_threshold)
    trade_threshold /= 100

    trade_interest = []
    has_token_1 = True  # This is starting token
    for index, price_pair in enumerate(zip(t1_prices, t2_prices)):
        x, y = (1, 0) if has_token_1 else (0, 1)
        price_ratio = price_pair[x] / price_pair[y]
        if price_ratio > 1 + trade_threshold:
            has_token_1 ^= True
            trade_interest.append(price_ratio - 1 - trade_threshold)
            # print(
            #     "Swapping {} for {} at index {} with increase of {}%".format(
            #         token_1 if has_token_1 else token_2,
            #         token_2 if has_token_1 else token_1,
            #         index,
            #         round(trade_interest[-1] * 100, 2)
            #     )
            # )

    return trade_interest


def high_ground_strategy(
        filepath: str,
        start_token: str,
        allowed_tokens: List[str],
        # Next few values should be percentages!
        maker_rate: float,
        dfusion_fee: float,
        other_exchange_fee: float,
) -> List[float]:
    print(
        "Running high-ground strategy with\n"
        "Allowed Tokens {}\n"
        "Starting Token {}\n"
        "Maker rate  = {}%\n"
        "dFusion fee = {}%\n"
        "Other fee   = {}%\n".format(
            allowed_tokens, start_token, maker_rate, dfusion_fee, other_exchange_fee
        )
    )

    with open(filepath, 'r') as file:
        data = json.loads(file.read())

    assert start_token in allowed_tokens, "start token isn't listed as allowed."

    price_dict = {
        token: list(list(zip(*data[token]['prices']))[1]) for token in allowed_tokens
    }
    token_map = list(price_dict.keys())

    trade_threshold = dfusion_fee + maker_rate + other_exchange_fee
    trade_threshold /= 100

    trade_interest = []
    token_holding = start_token
    for index, price_tuple in enumerate(zip(*price_dict.values())):
        price_ratios = [price / price_dict[token_holding][index] for price in price_tuple]
        if any(ratio > 1 + trade_threshold for ratio in price_ratios):
            max_ratio = max(price_ratios)
            interest_made = max_ratio - 1 - trade_threshold
            j = price_ratios.index(max_ratio)
            print(
                "Swapping {} for {} at index {} with increase of {}%".format(
                    token_holding.ljust(20, ' '),
                    token_map[j].ljust(20, ' '),
                    str(index).ljust(5),
                    round(interest_made * 100, 2)
                )
            )
            token_holding = token_map[j]
            trade_interest.append((token_holding, interest_made))
    return trade_interest


def made_interest_report(interest_list: List[Tuple[str, float]], maker_rate: float):
    valuation = 1
    for c in interest_list:
        valuation *= 1 + c
    accumulated_percent = round((valuation - 1) * 100, 2)
    maker_profit = round(((1 + maker_rate / 100) ** len(interest_list) - 1) * 100, 2)
    annual_estimate = (
        round((pow(1 + accumulated_percent / 100, 12) - 1) * 100, 2),
        round((pow(1 + maker_profit / 100, 12) - 1) * 100, 2)
    )
    res = "\nTotal trades: {}\nAccumulated interest (in %):\n" \
          " -- Arbitrager: {}\n" \
          " -- Liquidity Provider: {}\n" \
          "Projected Annual Return:\n" \
          " -- Arbitrager: {}\n" \
          " -- Liquidity Provider: {}".format(
        len(interest_list), accumulated_percent, maker_profit, annual_estimate[0], annual_estimate[1]
    )
    return (res)


if __name__ == '__main__':
    provider_rate = 3

    trade_path = high_ground_strategy(
        filepath='data/coins1M.json',
        start_token='dai',
        allowed_tokens=['tether', 'dai', 'trueusd', 'usd-coin', 'gemini-dollar', 'paxos-standard-token'],
        maker_rate=provider_rate,
        dfusion_fee=0.1,
        other_exchange_fee=0.5
    )

    print(made_interest_report([t[1] for t in trade_path], provider_rate))
