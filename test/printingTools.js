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
    digits: 3
  },
  {
    user: "0.01",
    machine: "100",
    digits: 4
  },
  {
    user: "1",
    machine: "100",
    digits: 2
  },
  {
    user: "104",
    machine: "104",
    digits: 0
  },
  {
    user: "0.002901",
    machine: "2901000000000000",
    digits: 18
  },
  {
    user: "1.002901",
    machine: "1002901000000000000",
    digits: 18
  },
  {
    user: "0." + bnMaxUint.toString().padStart(255, "0"),
    machine: bnMaxUint.toString(),
    digits: 255
  },
  {
    user: bnMaxUint.toString(),
    machine: bnMaxUint.toString(),
    digits: 0
  },
  {
    user: "0",
    machine: "0",
    digits: 0
  },
  {
    user: "0",
    machine: "0",
    digits: 18
  },
  {
    user: "0",
    machine: "0",
    digits: 255
  }
]

describe("fromUserToMachineReadable", () => {
  const testGoodEntries = function (entries) {
    for (const {user, machine, digits} of entries) {
      assert.equal(
        fromUserToMachineReadable(user, digits),
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
    for (const {user, machine, digits} of entries) {
      assert.equal(
        fromMachineToUserReadable(machine, digits),
        user,
        "Fail for user string " + user
      )
    }
  }
  it("works as expected with reasonable input", () => {
    testGoodEntries(goodTwoWayPairs)
  })
})
