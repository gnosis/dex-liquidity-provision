const BN = require("bn.js")
const assert = require("assert")
const { toErc20Units } = require("../scripts/utils/printing_tools")
const { getOutputAmountFromPrice, getUnlimitedOrderAmounts, isPriceReasonable } = require("../scripts/utils/price-utils")(
  web3,
  artifacts
)

const max128 = new BN(2).pow(new BN(128)).subn(1)
const floatTolerance = new BN(2).pow(new BN(52)) // same tolerance as float precision

const assertEqualUpToFloatPrecision = function(value, expected) {
  const differenceFromExpected = value.sub(expected).abs()
  assert(differenceFromExpected.mul(floatTolerance).lt(expected))
}

describe("getOutputAmountFromPrice", () => {
  it("computes the right output amount", () => {
    const testCases = [
      {
        price: 160,
        inputAmountString: "1",
        inputDecimals: 18,
        outputDecimals: 6,
        expectedOutputAmountString: "160",
      },
      {
        price: 1 / 160,
        inputAmountString: "160",
        inputDecimals: 6,
        outputDecimals: 18,
        expectedOutputAmountString: "1",
      },
      {
        price: 0.000125,
        inputAmountString: "8000",
        inputDecimals: 8,
        outputDecimals: 18,
        expectedOutputAmountString: "1",
      },
      {
        price: 10 ** 30,
        inputAmountString: "0.000000000000000000000001", // 10**-24
        inputDecimals: 100,
        outputDecimals: 1,
        expectedOutputAmountString: "1000000",
      },
      {
        price: 10.1,
        inputAmountString: "1",
        inputDecimals: 0,
        outputDecimals: 70,
        expectedOutputAmountString: "10.1",
      },
    ]
    for (const { price, inputAmountString, inputDecimals, outputDecimals, expectedOutputAmountString } of testCases) {
      const inputAmount = toErc20Units(inputAmountString, inputDecimals)
      const expectedOutputAmount = toErc20Units(expectedOutputAmountString, outputDecimals)
      const outputAmount = getOutputAmountFromPrice(price, inputAmount, inputDecimals, outputDecimals)
      assertEqualUpToFloatPrecision(outputAmount, expectedOutputAmount)
    }
  })
})

describe("getUnlimitedOrderAmounts", () => {
  it("computes the amounts needed to set up an unlimited order", () => {
    const testCases = [
      {
        price: 160,
        stableTokenDecimals: 18,
        targetTokenDecimals: 18,
        expectedStableTokenAmount: max128,
        expectedTargetTokenAmount: max128.divn(160),
      },
      {
        price: 1 / 160,
        stableTokenDecimals: 18,
        targetTokenDecimals: 18,
        expectedStableTokenAmount: max128.divn(160),
        expectedTargetTokenAmount: max128,
      },
      {
        price: 1,
        stableTokenDecimals: 18,
        targetTokenDecimals: 18,
        expectedStableTokenAmount: max128,
        expectedTargetTokenAmount: max128,
      },
      {
        price: 1 + Number.EPSILON,
        stableTokenDecimals: 18,
        targetTokenDecimals: 18,
        expectedStableTokenAmount: max128,
        expectedTargetTokenAmount: max128.sub(new BN(2).pow(new BN(128 - 52))),
      },
      {
        price: 1 - Number.EPSILON,
        stableTokenDecimals: 18,
        targetTokenDecimals: 18,
        expectedStableTokenAmount: max128.sub(new BN(2).pow(new BN(128 - 52))),
        expectedTargetTokenAmount: max128,
      },
      {
        price: 100,
        stableTokenDecimals: 165,
        targetTokenDecimals: 200,
        expectedStableTokenAmount: max128.div(new BN(10).pow(new BN(200 - 165 - 2))),
        expectedTargetTokenAmount: max128,
      },
      {
        price: 100,
        stableTokenDecimals: 200,
        targetTokenDecimals: 165,
        expectedStableTokenAmount: max128,
        expectedTargetTokenAmount: max128.div(new BN(10).pow(new BN(200 - 165 + 2))),
      },
    ]
    for (const {
      price,
      stableTokenDecimals,
      targetTokenDecimals,
      expectedStableTokenAmount,
      expectedTargetTokenAmount,
    } of testCases) {
      const [targetTokenAmount, stableTokenAmount] = getUnlimitedOrderAmounts(price, targetTokenDecimals, stableTokenDecimals)
      assertEqualUpToFloatPrecision(stableTokenAmount, expectedStableTokenAmount)
      assertEqualUpToFloatPrecision(targetTokenAmount, expectedTargetTokenAmount)
    }
  })
})

contract("PriceOracle", function() {
  describe("Price oracle sanity check", async () => {
    it("checks that price is within reasonable range (10 ≤ price ≤ 1990)", async () => {
      //the following test especially checks that the price p is not inverted (1/p) and is not below 1
      const acceptedPriceDeviationInPercentage = 99
      const price = 1000
      const targetTokenData = { symbol: "WETH" }
      const stableTokenData = { symbol: "DAI" }
      assert(await isPriceReasonable(targetTokenData, stableTokenData, price, acceptedPriceDeviationInPercentage))
    })
  })
})
