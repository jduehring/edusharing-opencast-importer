'use strict'

const logger = require('node-file-logger')
const CONF = require('../config/config.js')
const { esAxios } = require('../services/es-axios')
const pLimit = require('p-limit')
const { ESError, ESPostError } = require('../models/errors')
const existingNodes = require('../edu-sharing/get-existing-nodes.js')

async function createFolderForOcInstances(ocInstance, seriesData) {
  logger.Info('[ES API] Creating Edu-Sharing folder structure for ' + ocInstance)
  const modifiedSeriesData = seriesData
  const headers = getHeadersCreateFolder()
  const requests = []
  let existingDirs = []

  return await existingNodes
    .checkExistingDirs(ocInstance)
    .then(async (dirs) => {
      existingDirs = dirs
      await createMainFolder(ocInstance, existingDirs)
    })
    .then(async (res) => {
      if (seriesData.length < 2 && seriesData[0].type === 'metadata') return seriesData

      const limit = pLimit(CONF.es.settings.maxPendingPromises)
      for (let i = 1; i < modifiedSeriesData.length; i++) {
        let foundDir = false
        if (existingDirs.nodes) {
          for (const node of existingDirs.nodes) {
            if (node.name === modifyStringES(modifiedSeriesData[i].title)) {
              addNodeIdToSeries(node, i)
              foundDir = true
            }
          }
        }

        if (foundDir === false) {
          if (modifiedSeriesData[i].type === 'metadata') continue

          requests.push(
            limit(() =>
              sendPostRequest(
                getUrlCreateFolder(modifiedSeriesData[0].nodeId),
                getBodyCreateFolder(modifyStringES(modifiedSeriesData[i].title)),
                headers,
                ocInstance,
                i
              )
            )
          )
        }
      }
    })
    .then((res) => {
      return Promise.all(requests).then((res) => {
        return modifiedSeriesData
      })
    })
    .catch((error) => {
      if (error instanceof ESPostError && error.code === 'ECONNREFUSED') {
        logger.Error(error.message)
        return modifiedSeriesData
      } else if (error instanceof ESError) {
        throw error
      } else {
        throw new ESError('[ES API] Error while creating folder structure: ' + error.message)
      }
    })

  async function createMainFolder(ocInstance, dirs) {
    if (dirs.name === ocInstance) {
      return addMetadataToSeriesData(dirs)
    } else if (modifiedSeriesData[0].type === 'metadata') {
      return await sendPostRequest(
        getUrlCreateFolder(),
        getBodyCreateFolder(ocInstance),
        headers,
        ocInstance,
        0
      ).catch((error) => {
        if (error instanceof ESPostError) {
          throw error
        } else throw new ESError('[ES API] Error while creating folder structure: ' + error.message)
      })
    }
  }

  async function sendPostRequest(url, body, headers, ocInstance, index) {
    return await esAxios
      .post(url, body, headers)
      .then((response) => {
        if (response.status === 200) {
          return handleResponse(response, ocInstance, index)
        }
      })
      .catch((error) => {
        if (error.code === 'ECONNREFUSED') {
          throw new ESPostError(
            '[ES API] ' +
              CONF.es.protocol +
              '://' +
              CONF.es.domain +
              ' is not reachable - skipping',
            error.code
          )
        }
        throw new ESPostError(error.message, error.code)
      })
  }

  function handleResponse(res, ocInstance, index) {
    if (!res) throw Error(res)
    if (res.status === 200 && res.data.node.name === ocInstance) {
      logger.Info('[ES API] Created main folder for ' + ocInstance)
      return addMetadataToSeriesData(res.data.node)
    } else if (res.status === 200) {
      return addNodeIdToSeries(res.data.node, index)
    }
  }

  function addMetadataToSeriesData(response) {
    if (modifiedSeriesData[0].type === 'metadata') {
      modifiedSeriesData[0].nodeId = response.ref.id
      modifiedSeriesData[0].parentId = response.parent.id
    }
  }

  function addNodeIdToSeries(response, index) {
    modifiedSeriesData[index].nodeId = response.ref.id
    modifiedSeriesData[index].parentId = response.parent.id
    modifiedSeriesData[index].lastUpdated = new Date()
  }

  function getUrlCreateFolder(nodeId) {
    const nodeRoute = nodeId ? '/' + nodeId + '/children' : '/-userhome-/children'
    return (
      CONF.es.host.url +
      CONF.es.routes.api +
      CONF.es.routes.baseFolder +
      nodeRoute +
      '/?' +
      getParamsCreateFolder()
    )
  }

  function getParamsCreateFolder() {
    return new URLSearchParams({
      type: 'cm:folder',
      renameIfExists: false
    })
  }

  function getBodyCreateFolder(folderName) {
    // const randomName = ocInstance + '-' + Math.floor(Math.random() * 100000)
    return JSON.stringify({
      'cm:name': [folderName],
      'cm:edu_metadataset': ['mds'],
      'cm:edu_forcemetadataset': ['true']
    }).toString()
  }

  function getHeadersCreateFolder() {
    return {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'de-DE,en;q=0.7,en-US;q=0.3',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        locale: 'de_DE',
        Connection: 'keep-alive',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache'
      }
    }
  }
  function modifyStringES(s) {
    return s.replace(/ /g, '-').replace(/\(|\)/g, '').toLowerCase().substring(0, 50)
  }
}

module.exports = {
  createFolderForOcInstances
}
