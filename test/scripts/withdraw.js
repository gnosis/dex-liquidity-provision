const BN = require("bn.js")
const fs = require("fs").promises
const tmp = require("tmp-promise")
const assertNodejs = require("assert")
const utils = require("@gnosis.pm/safe-contracts/test/utils/general")
const Contract = require("@truffle/contract")

const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const ERC20 = artifacts.require("ERC20Detailed")
const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")
const TestToken = artifacts.require("DetailedMintableToken")

const { prepareTokenRegistration, addCustomMintableTokenToExchange, deploySafe } = require("../test_utils")
const {
  fetchTokenInfoFromExchange,
  fetchTokenInfoAtAddresses,
  deployFleetOfSafes,
  buildOrders,
  buildTransferApproveDepositFromList,
  buildTransferApproveDepositFromOrders,
  buildRequestWithdraw,
  buildWithdraw,
  buildTransferFundsToMaster,
  buildWithdrawAndTransferFundsToMaster,
  isOnlySafeOwner,
  maxU32,
} = require("../../scripts/utils/trading_strategy_helpers")(web3, artifacts)
const { waitForNSeconds, execTransaction } = require("../../scripts/utils/internals")(web3, artifacts)
const prepareWithdraw = require("../../scripts/wrapper/withdraw")(web3, artifacts)
const { toErc20Units, fromErc20Units } = require("../../scripts/utils/printing_tools")

contract("Withdraw script", function(accounts) {
  let lw
  let gnosisSafeMasterCopy
  let proxyFactory
  let exchange

  beforeEach(async function() {
    // Create lightwallet
    // TODO - can we just use accounts provided by ganache?
    lw = await utils.createLightwallet()

    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()

    BatchExchange.setProvider(web3.currentProvider)
    exchange = await BatchExchange.deployed()
  })

  const setup = async function(numberOfBrackets, amounts) {
    const masterSafe = await GnosisSafe.at(
      await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
    )
    const bracketAddresses = await deployFleetOfSafes(masterSafe.address, numberOfBrackets)
    const tokenInfo = []
    for (const { tokenData = {}, amount } of amounts) {
      const symbol = tokenData.symbol || "TEST"
      const decimals = tokenData.decimals || 18
      const { id, token } = await addCustomMintableTokenToExchange(exchange, symbol, decimals, accounts[0])
      tokenInfo.push({ symbol: symbol, decimals: decimals, id: id, token: token, address: token.address })
      await token.mint(masterSafe.address, toErc20Units(amount, decimals))
      const masterBalance = await token.balanceOf(masterSafe.address)
      assert.equal(fromErc20Units(masterBalance, decimals), amount, "Setup failed, did not deposit amount")
    }

    return [masterSafe, bracketAddresses, tokenInfo]
  }

  const evenDeposits = function(bracketAddresses, tokenData, amount) {
    const numberOfBrackets = bracketAddresses.length
    const amountToEach = toErc20Units(amount, tokenData.decimals)
      .div(new BN(numberOfBrackets))
      .toString()
    return bracketAddresses.map(bracketAddress => ({
      amount: amountToEach,
      tokenAddress: tokenData.address,
      bracketAddress: bracketAddress,
    }))
  }

  const deposit = async function(masterSafe, deposits) {
    const batchTransaction = await buildTransferApproveDepositFromList(masterSafe.address, deposits)
    await execTransaction(masterSafe, lw, batchTransaction)
    // Close auction for deposits to be reflected in exchange balance
    await waitForNSeconds(301)

    const amountsInExchange = {}
    const depositsOfBrackets = {}
    for (const { amount, tokenAddress, bracketAddress } of deposits) {
      amountsInExchange[tokenAddress] = (amountsInExchange[tokenAddress] || new BN(0)).add(new BN(amount))
      if (!depositsOfBrackets[tokenAddress]) depositsOfBrackets[tokenAddress] = {}
      depositsOfBrackets[tokenAddress][bracketAddress] = (depositsOfBrackets[tokenAddress][bracketAddress] || new BN(0)).add(
        new BN(amount)
      )
    }

    for (const { tokenAddress } of deposits) {
      const token = await ERC20.at(tokenAddress)
      assert.equal(
        (await token.balanceOf(exchange.address)).toString(),
        amountsInExchange[tokenAddress].toString(),
        "Balance setup failed: the exchange does not hold all tokens"
      )
      const tokenDepositsOfBrackets = depositsOfBrackets[tokenAddress]
      for (const bracketAddress in tokenDepositsOfBrackets) {
        assert.equal(
          (await exchange.getBalance(bracketAddress, tokenAddress)).toString(),
          tokenDepositsOfBrackets[bracketAddress].toString(),
          "Balance setup failed: the bracket is not the owner of the tokens in the exchange"
        )
      }
    }
  }
  it("requests withdrawals", async () => {
    const amounts = [{ token: { decimals: 18, symbol: "DAI" }, amount: "1000" }]
    const [masterSafe, bracketAddresses, tokenInfo] = await setup(2, amounts)
    const deposits = evenDeposits(bracketAddresses, tokenInfo[0], "1000")
    await deposit(masterSafe, deposits)
    const depositFile = await tmp.file()
    await fs.writeFile(depositFile.path, JSON.stringify(deposits))

    const argv = {
      masterSafe: masterSafe.address,
      withdrawalFile: depositFile.path,
      requestWithdraw: true,
    }
    const transaction = await prepareWithdraw(argv)
    await execTransaction(masterSafe, lw, transaction)

    for (const { amount, tokenAddress, bracketAddress } of deposits) {
      const requestedWithdrawal = (await exchange.getPendingWithdraw(bracketAddress, tokenAddress))[0].toString()
      assert.notEqual(requestedWithdrawal, "0", "Withdrawal was not requested")
      assert.equal(requestedWithdrawal, amount, "Bad amount requested to withdraw")
    }

    depositFile.cleanup()
  })
  it("withdraws", async () => {
    const amounts = [{ token: { decimals: 18, symbol: "DAI" }, amount: "1000" }]
    const [masterSafe, bracketAddresses, tokenInfo] = await setup(2, amounts)
    const token = tokenInfo[0].token
    const deposits = evenDeposits(bracketAddresses, tokenInfo[0], "1000")
    await deposit(masterSafe, deposits)
    const depositFile = await tmp.file()
    await fs.writeFile(depositFile.path, JSON.stringify(deposits))

    const argv1 = {
      masterSafe: masterSafe.address,
      withdrawalFile: depositFile.path,
      requestWithdraw: true,
    }
    const transaction1 = await prepareWithdraw(argv1)
    await execTransaction(masterSafe, lw, transaction1)
    await waitForNSeconds(301)

    const argv2 = {
      masterSafe: masterSafe.address,
      withdrawalFile: depositFile.path,
      withdraw: true,
    }
    const transaction2 = await prepareWithdraw(argv2)
    await execTransaction(masterSafe, lw, transaction2)

    for (const { amount, tokenAddress, bracketAddress } of deposits) {
      const requestedWithdrawal = (await exchange.getPendingWithdraw(bracketAddress, tokenAddress))[0].toString()
      const bracketBalance = (await token.balanceOf(bracketAddress)).toString()
      assert.equal(requestedWithdrawal, "0", "A withdrawal request is still pending")
      assert.equal(bracketBalance, amount, "Bad amount requested to withdraw")
    }

    depositFile.cleanup()
  })
  it("transfer funds to master", async () => {
    const amounts = [{ token: { decimals: 18, symbol: "DAI" }, amount: "1000" }]
    const [masterSafe, bracketAddresses, tokenInfo] = await setup(2, amounts)
    const token = tokenInfo[0].token
    const deposits = evenDeposits(bracketAddresses, tokenInfo[0], "1000")
    await deposit(masterSafe, deposits)
    const depositFile = await tmp.file()
    await fs.writeFile(depositFile.path, JSON.stringify(deposits))

    const argv1 = {
      masterSafe: masterSafe.address,
      withdrawalFile: depositFile.path,
      requestWithdraw: true,
    }
    const transaction1 = await prepareWithdraw(argv1)
    await execTransaction(masterSafe, lw, transaction1)
    await waitForNSeconds(301)

    const argv2 = {
      masterSafe: masterSafe.address,
      withdrawalFile: depositFile.path,
      withdraw: true,
    }
    const transaction2 = await prepareWithdraw(argv2)
    await execTransaction(masterSafe, lw, transaction2)

    const argv3 = {
      masterSafe: masterSafe.address,
      withdrawalFile: depositFile.path,
      transferFundsToMaster: true,
    }
    const transaction3 = await prepareWithdraw(argv3)
    await execTransaction(masterSafe, lw, transaction3)

    for (const { tokenAddress, bracketAddress } of deposits) {
      const requestedWithdrawal = (await exchange.getPendingWithdraw(bracketAddress, tokenAddress))[0].toString()
      const bracketBalance = (await token.balanceOf(bracketAddress)).toString()
      assert.equal(requestedWithdrawal, "0", "A withdrawal request is still pending")
      assert.equal(bracketBalance, "0", "Bracket balance is nonzero")
    }
    const masterBalance = (await token.balanceOf(masterSafe.address)).toString()
    assert.equal(masterBalance, toErc20Units("1000", 18).toString(), "Master safe did not receive tokens")

    depositFile.cleanup()
  })
  it.only("fails on bad input", async () => {
    const masterSafe = await GnosisSafe.at(
      await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
    )
    const badInput = [
      {
        argv: {
          masterSafe: masterSafe.address,
          withdrawalFile: "/dev/null",
          requestWithdraw: true,
          withdraw: true,
        },
        error: "Argument error: --requestWithdraw cannot be used with any of --withdraw, --transferFundsToMaster",
      },
      {
        argv: {
          masterSafe: masterSafe.address,
          withdrawalFile: "/dev/null",
          requestWithdraw: true,
          transferFundsToMaster: true,
        },
        error: "Argument error: --requestWithdraw cannot be used with any of --withdraw, --transferFundsToMaster",
      },
      {
        argv: {
          masterSafe: masterSafe.address,
          withdrawalFile: "/dev/null",
          requestWithdraw: true,
          withdraw: true,
          transferFundsToMaster: true,
        },
        error: "Argument error: --requestWithdraw cannot be used with any of --withdraw, --transferFundsToMaster",
      },
      {
        argv: {
          masterSafe: masterSafe.address,
          withdrawalFile: "/dev/null",
          requestWithdraw: true,
        },
        error: "Argument error: --requestWithdraw cannot be used with any of --withdraw, --transferFundsToMaster",
      },
    ]
    for (const { argv, error } of badInput)
      await assertNodejs.rejects(prepareWithdraw(argv), {
        message: error,
      })
  })
})
