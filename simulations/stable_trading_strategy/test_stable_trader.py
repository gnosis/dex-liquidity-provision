import unittest
from .stable_trader import basic_high_ground_strategy, made_interest_report, high_ground_strategy



class MyTestCase(unittest.TestCase):

    def setUp(self):
        self.maker_rate = 0.2
        self.dfusion_fee = 0.1
        self.other_exchange_fee = 0.5
        self.default_file_path = 'stable_trading_strategy/data/coins1M.json'

    def test_stable_trader(self):
        self.trade_path = basic_high_ground_strategy(
            filepath=self.default_file_path,
            token_1='dai',
            token_2='tether',
            maker_rate=self.maker_rate,
            dfusion_fee=self.dfusion_fee,
            other_exchange_fee=self.other_exchange_fee
        )
        made_interest_report(self.trade_path, self.maker_rate)

    def test_generalized_high_ground_all_tokens(self):
        # except bitusd. Don't use it.
        self.trade_path = high_ground_strategy(
            filepath=self.default_file_path,
            start_token='dai',
            allowed_tokens=['tether', 'dai', 'trueusd', 'susd', 'usd-coin', 'gemini-dollar', 'paxos-standard-token'],
            maker_rate=self.maker_rate,
            dfusion_fee=self.dfusion_fee,
            other_exchange_fee=self.other_exchange_fee
        )

        made_interest_report([t[1] for t in self.trade_path], self.maker_rate)

    def test_generalized_high_ground_all_available_tokens(self):
        # except bitusd. Don't use it.
        self.trade_path = high_ground_strategy(
            filepath=self.default_file_path,
            start_token='dai',
            allowed_tokens=['tether', 'dai', 'trueusd', 'susd', 'usd-coin', 'gemini-dollar', 'paxos-standard-token'],
            maker_rate=self.maker_rate,
            dfusion_fee=self.dfusion_fee,
            other_exchange_fee=self.other_exchange_fee
        )

        print(made_interest_report([t[1] for t in self.trade_path], self.maker_rate))

    def test_generalized_high_ground_tether_dai(self):
        # except bitusd. Don't use it.
        self.trade_path = high_ground_strategy(
            filepath=self.default_file_path,
            start_token='dai',
            allowed_tokens=['tether', 'dai'],
            maker_rate=self.maker_rate,
            dfusion_fee=self.dfusion_fee,
            other_exchange_fee=self.other_exchange_fee
        )

        made_interest_report([t[1] for t in self.trade_path], self.maker_rate)

    def test_generalized_high_ground_tether_dai_true(self):
        # except bitusd. Don't use it.
        self.trade_path = high_ground_strategy(
            filepath=self.default_file_path,
            start_token='dai',
            allowed_tokens=['tether', 'dai', 'trueusd'],
            maker_rate=self.maker_rate,
            dfusion_fee=self.dfusion_fee,
            other_exchange_fee=self.other_exchange_fee
        )
        
        made_interest_report([t[1] for t in self.trade_path], self.maker_rate)

if __name__ == '__main__':
    unittest.main()
