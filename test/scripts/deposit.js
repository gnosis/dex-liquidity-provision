const Contract = require("@truffle/contract")

const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")

const { addCustomMintableTokenToExchange, deploySafe } = require("../test_utils")
const { deployFleetOfSafes, buildDepositFromList } = require("../../scripts/utils/trading_strategy_helpers")(web3, artifacts)
const { waitForNSeconds, execTransaction } = require("../../scripts/utils/internals")(web3, artifacts)

contract("Deposit scripts", function (accounts) {
  let gnosisSafeMasterCopy
  let proxyFactory
  let exchange
  const safeOwner = accounts[0]
  beforeEach(async function () {
    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()

    BatchExchange.setProvider(web3.currentProvider)
    exchange = await BatchExchange.deployed()
  })

  const setup = async function (numberOfBrackets, amounts) {
    const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
    const bracketAddresses = await deployFleetOfSafes(masterSafe.address, numberOfBrackets)
    const tokenInfo = []
    const deposits = []
    for (const { tokenData = {}, amount } of amounts) {
      const symbol = tokenData.symbol || "TEST"
      const decimals = tokenData.decimals || 18
      // Adding token to exchange is not actually necessary since one can deposit and withdraw any token.
      const { id, token } = await addCustomMintableTokenToExchange(exchange, symbol, decimals, accounts[0])
      tokenInfo.push({ symbol, decimals, id, token, address: token.address })
      for (const bracket of bracketAddresses) {
        await token.mint(bracket, amount)
        deposits.push({
          amount: amount,
          tokenAddress: token.address,
          bracketAddress: bracket,
        })
      }
    }
    return [masterSafe, tokenInfo, deposits]
  }

  describe("buildDepositFromList:", () => {
    it("deposits 1000 DAI (in Wei) for two brackets", async () => {
      const amounts = [{ tokenData: { decimals: 18, symbol: "DAI" }, amount: "1000" }]
      const [masterSafe, tokenInfo, deposits] = await setup(2, amounts)
      const token = tokenInfo[0].token

      const transaction = await buildDepositFromList(masterSafe.address, deposits)
      await execTransaction(masterSafe, safeOwner, transaction)
      // Balance assertions before the batch is closed
      for (const { amount, tokenAddress, bracketAddress } of deposits) {
        const bracketBalance = (await token.balanceOf(bracketAddress)).toString()
        const exchangeBalance = (await exchange.getBalance(bracketAddress, tokenAddress)).toString()
        const pendingExchangeBalance = (await exchange.getPendingDeposit(bracketAddress, tokenAddress))[0].toString()
        assert.equal(bracketBalance, "0", "Bracket balance should be zero")
        assert.equal(exchangeBalance, "0", "Exchange balance should should be zero")
        assert.equal(pendingExchangeBalance, amount, "Exchange pending balance should contain amount")
      }
      await waitForNSeconds(301)
      // Balance assertions after batch is closed
      for (const { amount, tokenAddress, bracketAddress } of deposits) {
        const bracketBalance = (await token.balanceOf(bracketAddress)).toString()
        const exchangeBalance = (await exchange.getBalance(bracketAddress, tokenAddress)).toString()
        assert.equal(bracketBalance, "0", "Bracket balance should be zero")
        assert.equal(exchangeBalance, amount, "Exchange balance should should contain amount")
      }
    })
  })
})
