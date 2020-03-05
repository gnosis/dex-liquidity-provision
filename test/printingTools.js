// This test can be run directly using mocha:
// $ npx mocha test/printingTools.js
// Using truffle test works but it's much slower, since it needs to compile contracts and deploy them to the blockchain.

const BN = require("bn.js")
const assert = require("assert")

const {
  fromUserToMachineReadable,
  fromMachineToUserReadable,
  bnMaxUint
} = require("../scripts/utils/printing_tools")

const goodTwoWayPairs = [
  {
    user: "1.1",
    machine: "1100",
    decimals: 3
  },
  {
    user: "0.01",
    machine: "100",
    decimals: 4
  },
  {
    user: "1",
    machine: "100",
    decimals: 2
  },
  {
    user: "104",
    machine: "104",
    decimals: 0
  },
  {
    user: "0.002901",
    machine: "2901000000000000",
    decimals: 18
  },
  {
    user: "1.002901",
    machine: "1002901000000000000",
    decimals: 18
  },
  {
    user: "0." + bnMaxUint.toString().padStart(255, "0"),
    machine: bnMaxUint.toString(),
    decimals: 255
  },
  {
    user: bnMaxUint.toString(),
    machine: bnMaxUint.toString(),
    decimals: 0
  },
  {
    user: "0",
    machine: "0",
    decimals: 0
  },
  {
    user: "0",
    machine: "0",
    decimals: 18
  },
  {
    user: "0",
    machine: "0",
    decimals: 255
  }
]

describe("fromUserToMachineReadable", () => {
  const testGoodEntries = function (entries) {
    for (const {user, machine, decimals} of entries) {
      assert.equal(
        fromUserToMachineReadable(user, decimals),
        machine,
        "Fail for user string " + user
      )
    }
  }
  it("works as expected with reasonable input", () => {
    testGoodEntries(goodTwoWayPairs)
  })
})

describe("fromMachineToUserReadable", () => {
  const testGoodEntries = function (entries) {
    for (const {user, machine, decimals} of entries) {
      assert.equal(
        fromMachineToUserReadable(machine, decimals),
        user,
        "Fail for user string " + user
      )
    }
  }
  it("works as expected with reasonable input", () => {
    testGoodEntries(goodTwoWayPairs)
  })
})
