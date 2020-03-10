const BN = require("bn.js")
const utils = require("@gnosis.pm/safe-contracts/test/utils/general")
const exchangeUtils = require("@gnosis.pm/dex-contracts")
const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const TokenOWL = artifacts.require("TokenOWL")
const ERC20 = artifacts.require("ERC20Detailed")
const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")
const TestToken = artifacts.require("DetailedMintableToken")

const {
  deployFleetOfSafes,
  buildOrderTransaction,
  transferApproveDeposit,
  getRequestWithdraw,
  buildTransferApproveDepositTransaction,
  getWithdraw,
  getTransferFundsToMaster,
  getWithdrawAndTransferFundsToMaster,
  isOnlyOwner,
  max128,
  maxU32,
} = require("../scripts/utils/trading_strategy_helpers")
const { waitForNSeconds, toETH, execTransaction, deploySafe } = require("../scripts/utils/internals")

contract("GnosisSafe", function(accounts) {
  let lw
  let gnosisSafeMasterCopy
  let proxyFactory
  let testToken
  let exchange

  beforeEach(async function() {
    // Create lightwallet
    // TODO - can we just use accounts provided by ganache?
    lw = await utils.createLightwallet()

    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()
    testToken = await TestToken.new(18)

    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)
    exchange = await BatchExchange.deployed()
  })

  async function prepareTokenRegistration(account) {
    const owlToken = await TokenOWL.at(await exchange.feeToken())
    await owlToken.setMinter(account)
    await owlToken.mintOWL(account, toETH(10))
    await owlToken.approve(exchange.address, toETH(10))
  }

  it("Adds tokens to the exchange", async () => {
    await prepareTokenRegistration(accounts[0])
    await exchange.addToken(testToken.address, { from: accounts[0] })
    assert.equal(await exchange.tokenAddressToIdMap(testToken.address), 1)
  })

  it("Deploys Fleet of Gnosis Safes", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2, artifacts)
    const fleet = await deployFleetOfSafes(masterSafe.address, 10, artifacts)
    assert.equal(fleet.length, 10)
    for (const bracketAddress of fleet)
      assert(await isOnlyOwner(masterSafe.address, bracketAddress, artifacts))
  })

  it("transfers tokens from fund account through trader accounts and into exchange via manual deposit logic", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2, artifacts)
    const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 2, artifacts)
    const depositAmount = 1000
    await testToken.mint(accounts[0], depositAmount * bracketAddresses.length)
    await testToken.transfer(masterSafe.address, depositAmount * bracketAddresses.length)
    // Note that we are have NOT registered the tokens on the exchange but can deposit them nontheless.

    const deposits = bracketAddresses.map(bracketAddress => ({
      amount: depositAmount.toString(),
      tokenAddress: testToken.address,
      bracketAddress: bracketAddress,
    }))

    const batchTransaction = await transferApproveDeposit(masterSafe.address, deposits, web3, artifacts)

    await execTransaction(masterSafe, lw, batchTransaction)
    // Close auction for deposits to be refelcted in exchange balance
    await waitForNSeconds(301)

    for (const bracketAddress of bracketAddresses) {
      const bracketExchangeBalance = (await exchange.getBalance(bracketAddress, testToken.address)).toNumber()
      assert.equal(bracketExchangeBalance, depositAmount)
      const bracketPersonalTokenBalance = (await testToken.balanceOf(bracketAddress)).toNumber()
      // This should always output 0 as the brackets should never directly hold funds
      assert.equal(bracketPersonalTokenBalance, 0)
    }
  })

  it("transfers tokens from fund account through trader accounts and into exchange via automatic deposit logic", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2, artifacts)
    const fleetSize = 2
    const bracketAddresses = await deployFleetOfSafes(masterSafe.address, fleetSize, artifacts)
    const depositAmountStableToken = new BN(1000)
    const stableToken = await TestToken.new(18)
    await stableToken.mint(accounts[0], depositAmountStableToken.mul(new BN(bracketAddresses.length)))
    await stableToken.transfer(masterSafe.address, depositAmountStableToken.mul(new BN(bracketAddresses.length)))
    const depositAmountTargetToken = new BN(2000)
    const targetToken = await TestToken.new(18)
    await targetToken.mint(accounts[0], depositAmountTargetToken.mul(new BN(bracketAddresses.length)))
    await targetToken.transfer(masterSafe.address, depositAmountTargetToken.mul(new BN(bracketAddresses.length)))

    const batchTransaction = await buildTransferApproveDepositTransaction(
      masterSafe.address,
      bracketAddresses,
      stableToken.address,
      depositAmountStableToken,
      targetToken.address,
      depositAmountTargetToken,
      artifacts,
      web3
    )

    await execTransaction(masterSafe, lw, batchTransaction)
    // Close auction for deposits to be refelcted in exchange balance
    await waitForNSeconds(301)

    for (const bracketAddress of bracketAddresses.slice(0, fleetSize / 2)) {
      let bracketExchangeBalance = (await exchange.getBalance(bracketAddress, stableToken.address)).toNumber()
      assert.equal(bracketExchangeBalance, depositAmountStableToken)
      bracketExchangeBalance = (await exchange.getBalance(bracketAddress, targetToken.address)).toNumber()
      assert.equal(bracketExchangeBalance, 0)
      const bracketPersonalTokenBalance = (await testToken.balanceOf(bracketAddress)).toNumber()
      // This should always output 0 as the brackets should never directly hold funds
      assert.equal(bracketPersonalTokenBalance, 0)
    }
    for (const bracketAddress of bracketAddresses.slice(fleetSize / 2 + 1, fleetSize / 2)) {
      let bracketExchangeBalance = (await exchange.getBalance(bracketAddress, targetToken.address)).toNumber()
      assert.equal(bracketExchangeBalance, depositAmountTargetToken)
      bracketExchangeBalance = (await exchange.getBalance(bracketAddress, stableToken.address)).toNumber()
      assert.equal(bracketExchangeBalance, 0)
      const bracketPersonalTokenBalance = (await testToken.balanceOf(bracketAddress)).toNumber()
      // This should always output 0 as the brackets should never directly hold funds
      assert.equal(bracketPersonalTokenBalance, 0)
    }
  })

  it("Places bracket orders on behalf of a fleet of safes", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2, artifacts)
    // Number of brackets is determined by fleet size
    const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 20, artifacts)
    const targetToken = 0 // ETH
    const stableToken = 1 // DAI
    // const targetPrice = 270.6 // Price of ETH in USD  at 8:37 AM February 13, Berlin Germany
    const targetPrice = 100
    // add "stableToken" to exchange
    await prepareTokenRegistration(accounts[0])
    await exchange.addToken(testToken.address, { from: accounts[0] })

    const transaction = await buildOrderTransaction(
      masterSafe.address,
      bracketAddresses,
      targetToken,
      stableToken,
      targetPrice,
      web3,
      artifacts
    )
    await execTransaction(masterSafe, lw, transaction)

    // Correctness assertions
    for (const bracketAddress of bracketAddresses) {
      const auctionElements = exchangeUtils.decodeOrdersBN(await exchange.getEncodedUserOrders(bracketAddress))
      assert.equal(auctionElements.length, 2)
      const [buyOrder, sellOrder] = auctionElements
      assert(buyOrder.priceDenominator.eq(max128))
      assert(sellOrder.priceNumerator.eq(max128))
      // Checks that bracket orders are profitable for liquidity provider
      const initialAmount = new BN(10).pow(new BN(18))
      const amountAfterSelling = initialAmount.mul(sellOrder.priceNumerator).div(sellOrder.priceDenominator)
      const amountAfterBuying = amountAfterSelling.mul(buyOrder.priceNumerator).div(buyOrder.priceDenominator)
      assert.equal(amountAfterBuying.gt(initialAmount), true, "Brackets are not profitable")
      // ToDo: Checks order prices

      assert.equal(buyOrder.validUntil, maxU32, `Got ${sellOrder}`)
      assert.equal(sellOrder.validUntil, maxU32, `Got ${sellOrder}`)
    }
  })

  describe("Test withdrawals", async function() {
    const setupAndRequestWithdraw = async function(masterSafe, bracketAddresses, deposits, withdrawals) {
      const batchTransaction = await transferApproveDeposit(masterSafe.address, deposits, web3, artifacts)

      await execTransaction(masterSafe, lw, batchTransaction)
      // Close auction for deposits to be reflected in exchange balance
      await waitForNSeconds(301)
      const totalDepositedAmount = {}
      for (const { amount, tokenAddress, bracketAddress } of deposits) {
        const token = await ERC20.at(tokenAddress)
        assert.equal(
          (await token.balanceOf(bracketAddress)).toString(),
          "0",
          "Balance setup failed: trader Safes still holds funds"
        )

        if (typeof totalDepositedAmount[tokenAddress] === "undefined") totalDepositedAmount[tokenAddress] = new BN(amount)
        else totalDepositedAmount[tokenAddress] = totalDepositedAmount[tokenAddress].add(new BN(amount))
      }

      for (const [tokenAddress, totalAmountForToken] of Object.entries(totalDepositedAmount)) {
        const token = await ERC20.at(tokenAddress)
        assert.equal(
          (await token.balanceOf(masterSafe.address)).toString(),
          "0",
          "Balance setup failed: master Safe still holds funds"
        )
        assert.equal(
          (await token.balanceOf(exchange.address)).toString(),
          totalAmountForToken.toString(),
          "Balance setup failed: the exchange does not hold all tokens"
        )
      }

      const requestWithdrawalTransaction = await getRequestWithdraw(masterSafe.address, withdrawals, web3, artifacts)
      await execTransaction(
        masterSafe,
        lw,
        requestWithdrawalTransaction,
        "request withdrawal for all brackets"
      )
      await waitForNSeconds(301)

      const totalWithdrawnAmount = {}
      for (const { amount, tokenAddress, bracketAddress } of withdrawals) {
        const pendingWithdrawal = await exchange.getPendingWithdraw(bracketAddress, tokenAddress)
        assert.equal(pendingWithdrawal[0].toString(), amount.toString(), "Withdrawal was not registered on the exchange")

        const token = await ERC20.at(tokenAddress)
        assert.equal(
          (await token.balanceOf(bracketAddress)).toString(),
          "0",
          "Unexpected behavior in requestWithdraw: trader Safes holds funds"
        )

        totalWithdrawnAmount[tokenAddress] = (totalWithdrawnAmount[tokenAddress] || new BN(0)).add(new BN(amount))
      }

      for (const [tokenAddress, totalAmountForToken] of Object.entries(totalWithdrawnAmount)) {
        const token = await ERC20.at(tokenAddress)
        assert.equal(
          (await token.balanceOf(masterSafe.address)).toString(),
          "0",
          "Unexpected behavior in requestWithdraw: master Safe holds funds"
        )
        assert.equal(
          (await token.balanceOf(exchange.address)).toString(),
          totalAmountForToken.toString(),
          "Unexpected behavior in requestWithdraw: the exchange does not hold all tokens"
        )
      }
    }

    it("Withdraw full amount, three steps", async () => {
      const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2, artifacts)
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 2, artifacts)
      const depositAmount = toETH(200)
      const fullTokenAmount = depositAmount * bracketAddresses.length

      await testToken.mint(accounts[0], fullTokenAmount.toString())
      await testToken.transfer(masterSafe.address, fullTokenAmount.toString())

      const deposits = bracketAddresses.map(bracketAddress => ({
        amount: depositAmount,
        tokenAddress: testToken.address,
        bracketAddress: bracketAddress,
      }))
      // build withdrawal lists mirroring deposits
      const withdrawals = deposits.map(deposit => ({
        amount: deposit.amount,
        tokenAddress: deposit.tokenAddress,
        bracketAddress: deposit.bracketAddress,
      }))

      await setupAndRequestWithdraw(masterSafe, bracketAddresses, deposits, withdrawals)

      // withdrawalsModified has the original withdraw amounts plus an extra. It is used to test
      // that extra amounts are ignored by the script and just the maximal possible value is withdrawn
      const withdrawalsModified = withdrawals
      withdrawalsModified.map(withdraw => {
        withdraw.amount = withdraw.amount.add(toETH(1))
        withdraw
      })
      const withdrawalTransaction = await getWithdraw(masterSafe.address, withdrawalsModified, web3, artifacts)

      await execTransaction(
        masterSafe,
        lw,
        withdrawalTransaction,
        "withdraw for all brackets"
      )

      assert.equal(
        (await testToken.balanceOf(masterSafe.address)).toString(),
        "0",
        "Unexpected behavior when withdrawing: master Safe holds funds"
      )
      assert.equal(
        (await testToken.balanceOf(exchange.address)).toString(),
        "0",
        "Withdrawing failed: the exchange still holds all tokens"
      )
      for (const trader of bracketAddresses)
        assert.equal(
          (await testToken.balanceOf(trader)).toString(),
          depositAmount.toString(),
          "Withdrawing failed: trader Safes do not hold the correct amount of funds"
        )

      // tries to transfer more funds to master than available, script should be aware of it
      const transferFundsToMasterTransaction = await getTransferFundsToMaster(
        masterSafe.address,
        withdrawalsModified,
        true,
        web3,
        artifacts
      )

      await execTransaction(
        masterSafe,
        lw,
        transferFundsToMasterTransaction,
        "transfer funds to master for all brackets"
      )

      assert.equal(
        (await testToken.balanceOf(masterSafe.address)).toString(),
        fullTokenAmount.toString(),
        "Fund retrieval failed: master Safe does not hold all funds"
      )
      assert.equal(
        (await testToken.balanceOf(exchange.address)).toString(),
        "0",
        "Unexpected behavior when retrieving funds: the exchange holds funds"
      )
      for (const trader of bracketAddresses)
        assert.equal(
          (await testToken.balanceOf(trader)).toString(),
          "0",
          "Fund retrieval failed: trader Safes still hold some funds"
        )
    })

    it("Withdraw full amount, two steps", async () => {
      const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2, artifacts)
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 2, artifacts)
      const depositAmount = toETH(200)
      const fullTokenAmount = depositAmount * bracketAddresses.length

      await testToken.mint(accounts[0], fullTokenAmount.toString())
      await testToken.transfer(masterSafe.address, fullTokenAmount.toString())

      const deposits = bracketAddresses.map(bracketAddress => ({
        amount: depositAmount,
        tokenAddress: testToken.address,
        bracketAddress: bracketAddress,
      }))
      // build withdrawal lists mirroring deposits
      const withdrawals = deposits.map(deposit => ({
        amount: deposit.amount,
        tokenAddress: deposit.tokenAddress,
        bracketAddress: deposit.bracketAddress,
      }))

      await setupAndRequestWithdraw(masterSafe, bracketAddresses, deposits, withdrawals)

      const withdrawAndTransferFundsToMasterTransaction = await getWithdrawAndTransferFundsToMaster(
        masterSafe.address,
        withdrawals,
        web3,
        artifacts
      )
      await execTransaction(
        masterSafe,
        lw,
        withdrawAndTransferFundsToMasterTransaction,
        "withdraw and transfer back for all brackets"
      )

      assert.equal(
        (await testToken.balanceOf(masterSafe.address)).toString(),
        fullTokenAmount.toString(),
        "Fund retrieval failed: master Safe does not hold all funds"
      )
      assert.equal(
        (await testToken.balanceOf(exchange.address)).toString(),
        "0",
        "Unexpected behavior when retrieving funds: the exchange holds funds"
      )
      for (const trader of bracketAddresses)
        assert.equal(
          (await testToken.balanceOf(trader)).toString(),
          "0",
          "Fund retrieval failed: trader Safes still hold some funds"
        )
    })
  })
})
