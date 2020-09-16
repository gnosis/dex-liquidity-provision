/**
 * @typedef {import('../scripts/typedef.js').Address} Address
 */

const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")
const IProxy = artifacts.require("IProxy")
const FleetFactoryDeterministic = artifacts.require("FleetFactoryDeterministic")
const { deploySafe } = require("../scripts/utils/strategy_simulator")(web3, artifacts)
const { calcSafeAddresses } = require("../scripts/utils/calculate_fleet_addresses")(web3, artifacts)

contract("FleetFactoryDeterministic", function (accounts) {
  let gnosisSafeMasterCopy
  let proxyFactory
  let fleetFactory
  let master
  const masterController = accounts[1]

  beforeEach(async function () {
    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()
    fleetFactory = await FleetFactoryDeterministic.new(proxyFactory.address)
    master = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [masterController], 1))
  })

  it("is deployed with the right factory", async () => {
    const deployedFleetFactory = await FleetFactoryDeterministic.deployed()
    const retrievedProxyFactory = await deployedFleetFactory.proxyFactory()
    assert.equal(retrievedProxyFactory, ProxyFactory.address, "Wrong proxy factory after deployment")
  })

  describe("created safes", async function () {
    it("creates and logs new safes with several nonces", async () => {
      const numberOfSafes = 20
      const nonces = [0, 10, 17]

      nonces.forEach(async (nonce) => {
        const transcript = await fleetFactory.deployFleetWithNonce(
          master.address,
          numberOfSafes,
          gnosisSafeMasterCopy.address,
          nonce
        )
        const fleetCalculated = await calcSafeAddresses(numberOfSafes, nonce, fleetFactory, gnosisSafeMasterCopy.address)
        // the last event lists all created proxy, and is the only event decoded by Truffle
        assert.equal(transcript.receipt.rawLogs.length, numberOfSafes + 1, "More events than expected")
        assert.equal(transcript.logs.length, 1, "More events than expected")

        const emittedFleet = transcript.logs[0].args.fleet
        const emittedOwner = transcript.logs[0].args.owner
        assert.equal(emittedFleet.length, fleetCalculated.length, "FleetFactory did not log created Safes correctly")
        for (let i = 0; i < numberOfSafes; i++)
          assert.equal(
            emittedFleet[i].toLowerCase(),
            fleetCalculated[i].toLowerCase(),
            `FleetFactory did not log created Safes ${i} correctly for nonce ${nonce}`
          )
        assert.equal(emittedOwner, master.address, "FleetFactory did not log the correct owner")
      })
    })

    it("are owned by master", async () => {
      const numberOfSafes = 13
      const randomInt = 12345
      const transcript = await fleetFactory.deployFleetWithNonce(
        master.address,
        numberOfSafes,
        gnosisSafeMasterCopy.address,
        randomInt
      )
      const fleet = transcript.logs[0].args.fleet

      for (const safeAddress of fleet) {
        const safe = await GnosisSafe.at(safeAddress)
        const owners = await safe.getOwners()
        assert.equal(owners.length, 1, "There should be exactly one owner")
        assert.equal(owners[0], master.address, "There should be exactly one owner")
      }
    })

    it("have the right template", async () => {
      const numberOfSafes = 13
      const templateAddress = gnosisSafeMasterCopy.address
      const randomInt = 12345
      const transcript = await fleetFactory.deployFleetWithNonce(
        master.address,
        numberOfSafes,
        gnosisSafeMasterCopy.address,
        randomInt
      )
      const fleet = transcript.logs[0].args.fleet

      for (const safeAddress of fleet) {
        const safe = await IProxy.at(safeAddress)
        const retrievedTemplate = await safe.masterCopy()
        assert.equal(retrievedTemplate, templateAddress, "Created Safe uses wrong template")
      }
    })
  })
})
