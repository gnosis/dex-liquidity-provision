/**
 * @typedef {import('../scripts/typedef.js').Address} Address
 */

const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")
const IProxy = artifacts.require("IProxy")
const FleetFactory = artifacts.require("FleetFactory")

const { deploySafe } = require("../scripts/utils/strategy_simulator")(web3, artifacts)
const { decodeCreateProxy } = require("./test_utils")

contract("FleetFactory", function (accounts) {
  let gnosisSafeMasterCopy
  let proxyFactory
  let fleetFactory
  let master
  const masterController = accounts[1]

  beforeEach(async function () {
    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()
    fleetFactory = await FleetFactory.new(proxyFactory.address)
    master = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [masterController], 1))
  })

  it("is deployed with the right factory", async () => {
    const deployedFleetFactory = await FleetFactory.deployed()
    const retrievedProxyFactory = await deployedFleetFactory.proxyFactory()
    assert.equal(retrievedProxyFactory, ProxyFactory.address, "Wrong proxy factory after deployment")
  })

  it("creates and logs new safes", async () => {
    const numberOfSafes = 20
    const transcript = await fleetFactory.deployFleet(master.address, numberOfSafes, gnosisSafeMasterCopy.address)

    const fleet = []
    // the first events are the creation of new proxies with GnosisSafeProxyFactory
    // these events are not automatically decoded by Truffle because they come from internal transactions to another contract
    for (let i = 0; i < numberOfSafes; i++) {
      const rawLog = transcript.receipt.rawLogs[i]
      fleet.push(decodeCreateProxy(rawLog))
    }
    // the last event lists all created proxy, and is the only event decoded by Truffle
    assert.equal(transcript.receipt.rawLogs.length, numberOfSafes + 1, "More events than expected")
    assert.equal(transcript.logs.length, 1, "More events than expected")

    const emittedFleet = transcript.logs[0].args.fleet
    const emittedOwner = transcript.logs[0].args.owner
    assert.equal(emittedFleet.length, fleet.length, "FleetFactory did not log created Safes correctly")
    for (let i = 0; i < numberOfSafes; i++)
      assert.equal(emittedFleet[i], fleet[i], "FleetFactory did not log created Safes correctly")
    assert.equal(emittedOwner, master.address, "FleetFactory did not log the correct owner")
  })

  describe("created safes", async function () {
    it("are owned by master", async () => {
      const numberOfSafes = 13
      const transcript = await fleetFactory.deployFleet(master.address, numberOfSafes, gnosisSafeMasterCopy.address)
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
      const transcript = await fleetFactory.deployFleet(master.address, numberOfSafes, templateAddress)
      const fleet = transcript.logs[0].args.fleet

      for (const safeAddress of fleet) {
        const safe = await IProxy.at(safeAddress)
        const retrievedTemplate = await safe.masterCopy()
        assert.equal(retrievedTemplate, templateAddress, "Created Safe uses wrong template")
      }
    })
  })
})
