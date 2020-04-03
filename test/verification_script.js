const TestToken = artifacts.require("DetailedMintableToken")
const { getAllowances, assertNoAllowances } = require("../scripts/utils/trading_strategy_helpers")(web3, artifacts)

contract("verification checks", async accounts => {
  describe("allowances", async () => {
    let tokenInfo

    const createToken = async function(symbol, decimals) {
      const tokenData = {
        decimals: decimals,
        symbol: symbol,
      }
      const token = await TestToken.new(symbol, decimals)
      tokenData.address = token.address
      tokenData.instance = token
      return { address: token.address, tokenData: tokenData }
    }

    beforeEach(async () => {
      tokenInfo = {}
      const newTokens = [
        {symbol: "TEST1", decimals: 1},
        {symbol: "TEST2", decimals: 6},
      ]
      for (const {symbol, decimals} of newTokens) {
        const {address, tokenData} = await createToken(symbol, decimals)
        tokenInfo[address] = tokenData
      }
    })

    it("are found", async () => {
      const owner = accounts[1]
      const spender = accounts[2]
      const amount = "100"
      const allowedTokenAddress = Object.keys(tokenInfo)[0]
      const token = tokenInfo[allowedTokenAddress].instance
      await token.approve(spender, amount, { from: owner })
      const allowances = await getAllowances(owner, tokenInfo)
      const tokenAllowances = allowances[allowedTokenAddress]
      assert.equal(Object.keys(tokenAllowances).length, 1, "There should be exactly one allowance set")
      assert.equal(tokenAllowances[spender].toString(), amount, "The allowance amount is incorrect")
    })
    it("are up to date", async () => {
      const owner = accounts[1]
      const spender = accounts[2]
      const amountOld = "100"
      const amountNew = "200"
      const allowedTokenAddress = Object.keys(tokenInfo)[0]
      const token = tokenInfo[allowedTokenAddress].instance
      await token.approve(spender, amountOld, { from: owner })
      await token.approve(spender, amountNew, { from: owner })
      const allowances = await getAllowances(owner, tokenInfo)
      const tokenAllowances = allowances[allowedTokenAddress]
      assert.equal(Object.keys(tokenAllowances).length, 1, "There should be exactly one allowance set")
      assert.equal(tokenAllowances[spender].toString(), amountNew, "The allowance amount is incorrect")
    })
    it("do not trigger assertion if all zero", async () => {
      const owner = accounts[1]
      const spender = accounts[2]
      const amount = "0"
      const allowedTokenAddress = Object.keys(tokenInfo)[0]
      const token = tokenInfo[allowedTokenAddress].instance
      await token.approve(spender, amount, { from: owner })
      await assertNoAllowances(owner, tokenInfo)
    })
    it("trigger assertion if nonzero", async () => {
      const owner = accounts[1]
      const spender = accounts[2]
      const amount = "100"
      const allowedTokenAddress = Object.keys(tokenInfo)[0]
      const token = tokenInfo[allowedTokenAddress].instance
      await token.approve(spender, amount, { from: owner })
      let hasThrown = false
      try {
        await assertNoAllowances(owner, tokenInfo)
      } catch (error) {
        assert.equal(
          error.message,
          owner +
            " allows address " +
            spender +
            " to spend " +
            "TEST1" +
            " (amount: " +
            "10" + // token has 1 decimal
            ")",
          "Assertion was triggered for different reasons than expected"
        )
        hasThrown = true
      }
      assert(hasThrown, "Nonzero allowance did not cause assertion to fail")
    })
  })
})
