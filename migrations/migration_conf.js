const path = require("path")

const BUILD_DIR = path.join(__dirname, "../build", "contracts")
const networksFilePath = path.join(__dirname, process.env.NETWORKS_FILE)

module.exports = {
  buildPath: BUILD_DIR,
  buildDirDependencies: [],
  networkFilePath: networksFilePath,
}
