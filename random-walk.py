#!/usr/bin/python3

import random
from utils import floatEqual, randomWalk
from strategies import *

STARTING_PRICE = 160 # number of tokenA to get one tokenB

BALANCE_A = 10000
BALANCE_B = BALANCE_A / STARTING_PRICE

center = STARTING_PRICE
step = 1
interval = 1.3
amount = 21
balancesBracketTokenA = [BALANCE_A/amount]*amount
balancesBracketTokenB = [BALANCE_B/amount]*amount
assert floatEqual(sum(balancesBracketTokenA), BALANCE_A) and \
    floatEqual(sum(balancesBracketTokenB), BALANCE_B), \
    "The balances in the brackets must sum up to each token's balance"

serialStrategy = SerializedBraketsStrategy(
    center,
    step,
    interval,
    amount,
    balancesBracketTokenA,
    balancesBracketTokenB
)
serialStrategy.setupForRW()

amount = 10
radius = 5
balancesBracketTokenA = [BALANCE_A/amount]*amount
balancesBracketTokenB = [BALANCE_B/amount]*amount
concentricStrategy = ConcentricBraketsStrategy(
    center,
    amount,
    radius,
    balancesBracketTokenA,
    balancesBracketTokenB
)
concentricStrategy.setupForRW()

def printBalanceComparison(strategy, price):
    newBalanceA = strategy.getTokenABalance()
    newBalanceB = strategy.getTokenBBalance()
    print("(balanceA, balanceB) = ({:.1f}, {:.1f})".format(newBalanceA, newBalanceB))
    equivalentBalAAtStartingPrice = newBalanceA + price * newBalanceB
    print("  as TokenA with TokenB at current price:      {:.1f}".format(equivalentBalAAtStartingPrice))
    balAIfHolding  = BALANCE_A + price * BALANCE_B
    print("  as TokenA if holding from the start instead: {:.1f}".format(balAIfHolding))
    equivalentBalAAtStartingPrice = newBalanceA + STARTING_PRICE * newBalanceB
    print(" (as TokenA with TokenB at starting price:     {:.1f})".format(equivalentBalAAtStartingPrice))
    percentGainComparedToHolding = (equivalentBalAAtStartingPrice - balAIfHolding) / balAIfHolding * 100
    print("  change compared to just holding: {:.1f}%".format(percentGainComparedToHolding))

def percentGain(strategy, price):
    newBalanceA = strategy.getTokenABalance()
    newBalanceB = strategy.getTokenBBalance()
    equivalentBalAAtStartingPrice = newBalanceA + price * newBalanceB
    balAIfHolding  = BALANCE_A + price * BALANCE_B
    percentGainComparedToHolding = (equivalentBalAAtStartingPrice - balAIfHolding) / balAIfHolding * 100
    return percentGainComparedToHolding

def printBalanceAtEveryTrade(strategy, price):
    if strategy.thereWasATrade():
        printBalanceComparison(strategy, price)
        input()

# this function prints on screen the evolution of the price and stops at each trade
# executed by the strategy, presenting an overview of the result.
def runAndPrintStrategy(strategy, seed=None):
    if seed == None:
        seed = random.randrange(2**63-1)
        print("RNG seed: {}".format(seed))
    for price in randomWalk(seed, STARTING_PRICE):
        print("{:.2f}".format(price))
        strategy.execute(price)
        printBalanceAtEveryTrade(strategy, price)
    printBalanceComparison(strategy, price)
#runAndPrintStrategy(serialStrategy)

# this function of code calculates the average change in balance compared to just holding
# after running the strategy for a long period of time 
def getAverageChange(strategy):
    sumPercentGain = 0
    NUM_TRIALS = 10**3
    for i in range(NUM_TRIALS):
        print("{}/{}".format(i, NUM_TRIALS))
        strategy.reset()
        seed = random.randrange(2**63-1)
        for price in randomWalk(seed, STARTING_PRICE):
            strategy.execute(price)
        finalPercentGain = percentGain(strategy, price)
        sumPercentGain += finalPercentGain
        print("Current gain: \t{:.3f}%, \trolling average:\t {:.3f}%.".format(finalPercentGain, sumPercentGain / (i+1)))
    averagePercentGain = sumPercentGain / NUM_TRIALS
    print("Comparing to holding the initial balance, this strategy changes the final balance on average by {:.3f}%".format(averagePercentGain))
    return averagePercentGain

getAverageChange(concentricStrategy)
#runAndPrintStrategy(concentricStrategy)