const csv = require("csv-parser")
const fs = require("fs")

const parseCsvFile = async function (filePath) {
  return new Promise((resolve, reject) => {
    const results = []
    fs.createReadStream(filePath, { encoding: "utf-8" })
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => resolve(results))
      .on("error", (error) => reject(error))
  })
}

module.exports = {
  parseCsvFile,
}
