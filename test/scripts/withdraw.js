const BN = require("bn.js")
const fs = require("fs").promises
const tmp = require("tmp-promise")
const assertNodejs = require("assert")
const Contract = require("@truffle/contract")

const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const ERC20 = artifacts.require("ERC20Detailed")
const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")

const { addCustomMintableTokenToExchange, deploySafe } = require("../test_utils")
const { deployFleetOfSafes, buildTransferApproveDepositFromList } = require("../../scripts/utils/trading_strategy_helpers")(
  web3,
  artifacts
)
const { waitForNSeconds, execTransaction } = require("../../scripts/utils/internals")(web3, artifacts)
const prepareWithdraw = require("../../scripts/wrapper/withdraw")(web3, artifacts)
const { toErc20Units, fromErc20Units } = require("../../scripts/utils/printing_tools")

contract("Withdraw script", function (accounts) {
  let gnosisSafeMasterCopy
  let proxyFactory
  let exchange
  let safeOwner
  beforeEach(async function () {
    // For the safeOwner, the privateKey needs to be known to sign transactions. Since ganache is
    // started in deterministic mode, we know the privateKey upfront and can hardcode it.
    safeOwner = { account: accounts[0], privateKey: "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d" }

    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()

    BatchExchange.setProvider(web3.currentProvider)
    exchange = await BatchExchange.deployed()
  })

  const setup = async function (numberOfBrackets, amounts) {
    const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
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

  const evenDeposits = function (bracketAddresses, tokenData, amount) {
    const numberOfBrackets = bracketAddresses.length
    const amountToEach = toErc20Units(amount, tokenData.decimals).div(new BN(numberOfBrackets)).toString()
    return bracketAddresses.map((bracketAddress) => ({
      amount: amountToEach,
      tokenAddress: tokenData.address,
      bracketAddress: bracketAddress,
    }))
  }

  const deposit = async function (masterSafe, deposits) {
    const batchTransaction = await buildTransferApproveDepositFromList(masterSafe.address, deposits)
    await execTransaction(masterSafe, safeOwner.privateKey, batchTransaction)
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
  describe("using withdrawal file", () => {
    it("requests withdrawals", async () => {
      const amounts = [{ tokenData: { decimals: 18, symbol: "DAI" }, amount: "1000" }]
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
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)

      for (const { amount, tokenAddress, bracketAddress } of deposits) {
        const requestedWithdrawal = (await exchange.getPendingWithdraw(bracketAddress, tokenAddress))[0].toString()
        assert.notEqual(requestedWithdrawal, "0", "Withdrawal was not requested")
        assert.equal(requestedWithdrawal, amount, "Bad amount requested to withdraw")
      }

      depositFile.cleanup()
    })
    it("withdraws", async () => {
      const amounts = [{ tokenData: { decimals: 18, symbol: "DAI" }, amount: "1000" }]
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
      await execTransaction(masterSafe, safeOwner.privateKey, transaction1)
      await waitForNSeconds(301)

      const argv2 = {
        masterSafe: masterSafe.address,
        withdrawalFile: depositFile.path,
        withdraw: true,
      }
      const transaction2 = await prepareWithdraw(argv2)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction2)

      for (const { amount, tokenAddress, bracketAddress } of deposits) {
        const bracketBalance = (await token.balanceOf(bracketAddress)).toString()
        const requestedWithdrawal = (await exchange.getPendingWithdraw(bracketAddress, tokenAddress))[0].toString()
        assert.equal(bracketBalance, amount, "Bad amount requested to withdraw")
        assert.equal(requestedWithdrawal, "0", "A withdrawal request is still pending")
      }

      depositFile.cleanup()
    })
    it("transfers funds to master", async () => {
      const amounts = [{ tokenData: { decimals: 18, symbol: "DAI" }, amount: "1000" }]
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
      await execTransaction(masterSafe, safeOwner.privateKey, transaction1)
      await waitForNSeconds(301)

      const argv2 = {
        masterSafe: masterSafe.address,
        withdrawalFile: depositFile.path,
        withdraw: true,
      }
      const transaction2 = await prepareWithdraw(argv2)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction2)

      const argv3 = {
        masterSafe: masterSafe.address,
        withdrawalFile: depositFile.path,
        transferFundsToMaster: true,
      }
      const transaction3 = await prepareWithdraw(argv3)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction3)

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
    it("withdraws and transfers simultaneously", async () => {
      const amounts = [{ tokenData: { decimals: 18, symbol: "DAI" }, amount: "1000" }]
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
      await execTransaction(masterSafe, safeOwner.privateKey, transaction1)
      await waitForNSeconds(301)

      const argv2 = {
        masterSafe: masterSafe.address,
        withdrawalFile: depositFile.path,
        withdraw: true,
        transferFundsToMaster: true,
      }
      const transaction2 = await prepareWithdraw(argv2)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction2)

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
  })
  describe("using explicit from addresses", () => {
    it("requests withdrawals", async () => {
      const amounts = [
        { tokenData: { decimals: 6, symbol: "USDC" }, amount: "10000" },
        { tokenData: { decimals: 18, symbol: "WETH" }, amount: "50" },
      ]
      const [masterSafe, bracketAddresses, tokenInfo] = await setup(4, amounts)
      // deposits: brackets 0,1,2 have USDC, brackets 2,3 have ETH
      const depositsUsdc = evenDeposits(bracketAddresses.slice(0, 3), tokenInfo[0], "8000")
      const depositsWeth = evenDeposits(bracketAddresses.slice(2, 4), tokenInfo[1], "40")
      const deposits = depositsUsdc.concat(depositsWeth)
      await deposit(masterSafe, deposits)

      const argv = {
        masterSafe: masterSafe.address,
        brackets: bracketAddresses,
        tokens: [tokenInfo[0].address, tokenInfo[1].address],
        requestWithdraw: true,
      }
      const transaction = await prepareWithdraw(argv)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)

      for (const { amount, tokenAddress, bracketAddress } of deposits) {
        const requestedWithdrawal = (await exchange.getPendingWithdraw(bracketAddress, tokenAddress))[0].toString()
        assert.notEqual(requestedWithdrawal, "0", "Withdrawal was not requested")
        assert.equal(requestedWithdrawal, amount, "Bad amount requested to withdraw")
      }
    })
    it("requests withdrawals with token Ids", async () => {
      const amounts = [
        { tokenData: { decimals: 6, symbol: "USDC" }, amount: "10000" },
        { tokenData: { decimals: 18, symbol: "WETH" }, amount: "50" },
      ]
      const [masterSafe, bracketAddresses, tokenInfo] = await setup(4, amounts)
      const usdcId = await exchange.tokenAddressToIdMap(tokenInfo[0].address)
      const wethId = await exchange.tokenAddressToIdMap(tokenInfo[1].address)
      // deposits: brackets 0,1,2 have USDC, brackets 2,3 have ETH
      const depositsUsdc = evenDeposits(bracketAddresses.slice(0, 3), tokenInfo[0], "8000")
      const depositsWeth = evenDeposits(bracketAddresses.slice(2, 4), tokenInfo[1], "40")
      const deposits = depositsUsdc.concat(depositsWeth)
      await deposit(masterSafe, deposits)

      const argv = {
        masterSafe: masterSafe.address,
        brackets: bracketAddresses,
        tokenIds: [usdcId, wethId],
        requestWithdraw: true,
      }
      const transaction = await prepareWithdraw(argv)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction)

      for (const { amount, tokenAddress, bracketAddress } of deposits) {
        const requestedWithdrawal = (await exchange.getPendingWithdraw(bracketAddress, tokenAddress))[0].toString()
        assert.notEqual(requestedWithdrawal, "0", "Withdrawal was not requested")
        assert.equal(requestedWithdrawal, amount, "Bad amount requested to withdraw")
      }
    })
    it("withdraws", async () => {
      const amounts = [
        { tokenData: { decimals: 6, symbol: "USDC" }, amount: "10000" },
        { tokenData: { decimals: 18, symbol: "WETH" }, amount: "50" },
      ]
      const [masterSafe, bracketAddresses, tokenInfo] = await setup(4, amounts)
      // deposits: brackets 0,1,2 have USDC, brackets 2,3 have ETH
      const depositsUsdc = evenDeposits(bracketAddresses.slice(0, 3), tokenInfo[0], "8000")
      const depositsWeth = evenDeposits(bracketAddresses.slice(2, 4), tokenInfo[1], "40")
      const deposits = depositsUsdc.concat(depositsWeth)
      await deposit(masterSafe, deposits)

      const argv1 = {
        masterSafe: masterSafe.address,
        brackets: bracketAddresses,
        tokens: [tokenInfo[0].address, tokenInfo[1].address],
        requestWithdraw: true,
      }
      const transaction1 = await prepareWithdraw(argv1)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction1)
      await waitForNSeconds(301)

      const argv2 = {
        masterSafe: masterSafe.address,
        brackets: bracketAddresses,
        tokens: [tokenInfo[0].address, tokenInfo[1].address],
        withdraw: true,
      }
      const transaction2 = await prepareWithdraw(argv2)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction2)

      for (const { amount, tokenAddress, bracketAddress } of deposits) {
        const bracketBalance = (await (await ERC20.at(tokenAddress)).balanceOf(bracketAddress)).toString()
        const requestedWithdrawal = (await exchange.getPendingWithdraw(bracketAddress, tokenAddress))[0].toString()
        assert.equal(bracketBalance, amount, "Bad amount requested to withdraw")
        assert.equal(requestedWithdrawal, "0", "A withdrawal request is still pending")
      }
    })
    it("transfers funds to master", async () => {
      const amounts = [
        { tokenData: { decimals: 6, symbol: "USDC" }, amount: "10000" },
        { tokenData: { decimals: 18, symbol: "WETH" }, amount: "50" },
      ]
      const [masterSafe, bracketAddresses, tokenInfo] = await setup(4, amounts)
      const usdcToken = await ERC20.at(tokenInfo[0].address)
      const wethToken = await ERC20.at(tokenInfo[1].address)
      // deposits: brackets 0,1,2 have USDC, brackets 2,3 have ETH
      const depositsUsdc = evenDeposits(bracketAddresses.slice(0, 3), tokenInfo[0], "8000")
      const depositsWeth = evenDeposits(bracketAddresses.slice(2, 4), tokenInfo[1], "40")
      const deposits = depositsUsdc.concat(depositsWeth)
      await deposit(masterSafe, deposits)

      const argv1 = {
        masterSafe: masterSafe.address,
        brackets: bracketAddresses,
        tokens: [tokenInfo[0].address, tokenInfo[1].address],
        requestWithdraw: true,
      }
      const transaction1 = await prepareWithdraw(argv1)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction1)
      await waitForNSeconds(301)

      const argv2 = {
        masterSafe: masterSafe.address,
        brackets: bracketAddresses,
        tokens: [tokenInfo[0].address, tokenInfo[1].address],
        withdraw: true,
      }
      const transaction2 = await prepareWithdraw(argv2)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction2)

      const argv3 = {
        masterSafe: masterSafe.address,
        brackets: bracketAddresses,
        tokens: [tokenInfo[0].address, tokenInfo[1].address],
        transferFundsToMaster: true,
      }
      const transaction3 = await prepareWithdraw(argv3)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction3)

      for (const { tokenAddress, bracketAddress } of deposits) {
        const requestedWithdrawal = (await exchange.getPendingWithdraw(bracketAddress, tokenAddress))[0].toString()
        const bracketBalance = (await (await ERC20.at(tokenAddress)).balanceOf(bracketAddress)).toString()
        assert.equal(requestedWithdrawal, "0", "A withdrawal request is still pending")
        assert.equal(bracketBalance, "0", "Bracket balance is nonzero")
      }
      const usdcMasterBalance = (await usdcToken.balanceOf(masterSafe.address)).toString()
      const wethMasterBalance = (await wethToken.balanceOf(masterSafe.address)).toString()
      assert.equal(usdcMasterBalance, toErc20Units("10000", 6).toString(), "Master safe did not receive USDC")
      assert.equal(wethMasterBalance, toErc20Units("50", 18).toString(), "Master safe did not receive WETH")
    })
    it("withdraws and transfers simultaneously", async () => {
      const amounts = [
        { tokenData: { decimals: 6, symbol: "USDC" }, amount: "10000" },
        { tokenData: { decimals: 18, symbol: "WETH" }, amount: "50" },
      ]
      const [masterSafe, bracketAddresses, tokenInfo] = await setup(4, amounts)
      const usdcToken = await ERC20.at(tokenInfo[0].address)
      const wethToken = await ERC20.at(tokenInfo[1].address)
      // deposits: brackets 0,1,2 have USDC, brackets 2,3 have ETH
      const depositsUsdc = evenDeposits(bracketAddresses.slice(0, 3), tokenInfo[0], "8000")
      const depositsWeth = evenDeposits(bracketAddresses.slice(2, 4), tokenInfo[1], "40")
      const deposits = depositsUsdc.concat(depositsWeth)
      await deposit(masterSafe, deposits)

      const argv1 = {
        masterSafe: masterSafe.address,
        brackets: bracketAddresses,
        tokens: [tokenInfo[0].address, tokenInfo[1].address],
        requestWithdraw: true,
      }
      const transaction1 = await prepareWithdraw(argv1)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction1)
      await waitForNSeconds(301)

      const argv2 = {
        masterSafe: masterSafe.address,
        brackets: bracketAddresses,
        tokens: [tokenInfo[0].address, tokenInfo[1].address],
        withdraw: true,
        transferFundsToMaster: true,
      }
      const transaction2 = await prepareWithdraw(argv2)
      await execTransaction(masterSafe, safeOwner.privateKey, transaction2)

      for (const { tokenAddress, bracketAddress } of deposits) {
        const requestedWithdrawal = (await exchange.getPendingWithdraw(bracketAddress, tokenAddress))[0].toString()
        const bracketBalance = (await (await ERC20.at(tokenAddress)).balanceOf(bracketAddress)).toString()
        assert.equal(requestedWithdrawal, "0", "A withdrawal request is still pending")
        assert.equal(bracketBalance, "0", "Bracket balance is nonzero")
      }
      const usdcMasterBalance = (await usdcToken.balanceOf(masterSafe.address)).toString()
      const wethMasterBalance = (await wethToken.balanceOf(masterSafe.address)).toString()
      assert.equal(usdcMasterBalance, toErc20Units("10000", 6).toString(), "Master safe did not receive USDC")
      assert.equal(wethMasterBalance, toErc20Units("50", 18).toString(), "Master safe did not receive WETH")
    })
  })
  it("fails on bad input", async () => {
    const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner.account], 1))
    const badInput = [
      {
        argv: {},
        error: "Argument error: --masterSafe is required",
      },
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
          withdrawalFile: "/dev/zero",
        },
        error: "Argument error: one of --requestWithdraw, --withdraw, --transferFundsToMaster must be given",
      },
      {
        argv: {
          masterSafe: masterSafe.address,
          requestWithdraw: true,
          withdrawalFile: "/dev/zero",
          brackets: "0x0,0x1",
        },
        error: "Argument error: --brackets cannot be used with --withdrawalFile",
      },
      {
        argv: {
          masterSafe: masterSafe.address,
          requestWithdraw: true,
        },
        error: "Argument error: one of --withdrawalFile, --brackets must be given",
      },
      {
        argv: {
          masterSafe: masterSafe.address,
          requestWithdraw: true,
          brackets: "0x0,0x1",
        },
        error: "Argument error: one of --tokens, --tokenIds must be given when using --brackets",
      },
      {
        argv: {
          masterSafe: masterSafe.address,
          requestWithdraw: true,
          brackets: "0x0,0x1",
          tokens: "0x0,0x1",
          tokenIds: "0,1",
        },
        error: "Argument error: only one of --tokens, --tokenIds is required when using --brackets",
      },
      {
        argv: {
          masterSafe: masterSafe.address,
          requestWithdraw: true,
          withdrawalFile: "/dev/zero",
          tokens: "0x0,0x1",
          tokenIds: "0,1",
        },
        error: "Argument error: --tokens or --tokenIds can only be used with --brackets",
      },
      {
        argv: {
          masterSafe: masterSafe.address,
          withdrawalFile: "/dev/zero",
          requestWithdraw: true,
          tokens: "0x0,0x1",
        },
        error: "Argument error: --tokens or --tokenIds can only be used with --brackets",
      },
      {
        argv: {
          masterSafe: masterSafe.address,
          withdrawalFile: "/dev/zero",
          requestWithdraw: true,
          tokenIds: "0,1",
        },
        error: "Argument error: --tokens or --tokenIds can only be used with --brackets",
      },
    ]
    for (const { argv, error } of badInput)
      await assertNodejs.rejects(prepareWithdraw(argv), {
        message: error,
      })
  })
})
