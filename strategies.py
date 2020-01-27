#!/usr/bin/python3

from abc import ABC, abstractmethod
from utils import floatCloseInRW

class Strategy(ABC):
    tradeExecuted = False

    def setStartingBalances(self, _startingBalancesTokenA, _startingBalancesTokenB):
        self.startingBalancesTokenA = _startingBalancesTokenA[::]
        self.startingBalancesTokenB = _startingBalancesTokenB[::]

    def reset(self):
        self.balancesTokenA = self.startingBalancesTokenA[::]
        self.balancesTokenB = self.startingBalancesTokenB[::]

    # price input is expressed as amounts of token A you get for one token B
    # the lower the price, the more token B is cheap
    def execute(self, price):
        self.tradeExecuted = False
        for bracketIndex in range(0, self.amount):
            if floatCloseInRW(self.bracketBuy[bracketIndex], price) and \
                    self.balancesTokenA[bracketIndex] != 0:
                # buy token B
                self.balancesTokenB[bracketIndex] += self.balancesTokenA[bracketIndex] / price
                self.balancesTokenA[bracketIndex] = 0
                self.tradeExecuted = True
            if floatCloseInRW(self.bracketSell[bracketIndex], price) and \
                    self.balancesTokenB[bracketIndex] != 0:
                # sell token B
                self.balancesTokenA[bracketIndex] += self.balancesTokenB[bracketIndex] * price
                self.balancesTokenB[bracketIndex] = 0
                self.tradeExecuted = True

    @abstractmethod
    def getBracketValues(self):
        pass

    def getTokenABalance(self):
        return sum(self.balancesTokenA)

    def getTokenBBalance(self):
        return sum(self.balancesTokenB)

    def thereWasATrade(self):
        return self.tradeExecuted

class SerializedBraketsStrategy(Strategy):
    def __init__(self, _center, _step, _interval, _amount, _balancesTokenA, _balancesTokenB):
        """
        The strategy defines _amount trading brackets, each with price ranging from some p to p+_step.
        The distance from one p to the next is _interval.
        The brackets are centered around _center.
        For every bracket (p, p+_step), the strategy works as follows:
        if the price is lower than p, buy.
        if the price is higher than p+_step, sell.
        """
        assert _amount >= 1, "Need at least one bracket"
        assert len(_balancesTokenA) == _amount == len(_balancesTokenB), "Need to specify balance for each bracket"
        self.center = _center
        self.step = _step
        self.interval = _interval
        self.amount = _amount
        self.setStartingBalances(_balancesTokenA, _balancesTokenB)
        self.reset()
        self.getBracketValues()

    def getBracketValues(self):
        leftmostIntervalStart = self.center - (self.amount * self.interval) // 2
        gapIntervalBracket = self.interval - self.step
        leftmostbracketBuy = leftmostIntervalStart + gapIntervalBracket // 2
        self.bracketBuy = [leftmostbracketBuy]
        self.bracketSell = [leftmostbracketBuy + self.step]
        for bracketIndex in range(0, self.amount):
            self.bracketBuy += [self.bracketBuy[bracketIndex] + self.interval]
            self.bracketSell += [self.bracketSell[bracketIndex] + self.interval]

