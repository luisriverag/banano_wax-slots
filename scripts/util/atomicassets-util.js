'use strict';
// libraries
const fetch = require('node-fetch');
const {ExplorerApi} = require('atomicassets');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const request = require('request');
const sharp = require('sharp');

// modules
const assetUtil = require('./asset-util.js');
const dateUtil = require('./date-util.js');
const timedCacheUtil = require('./timed-cache-util.js');
const awaitSemaphore = require('await-semaphore');
const randomUtil = require('./random-util.js');

// constants

// variables
/* eslint-disable no-unused-vars */
let config;
let loggingUtil;
const templates = [];
let ready = false;
let mutex;
/* eslint-enable no-unused-vars */

const ownerAssetCacheMap = new Map();
const excludedTemplateSet = new Set();
const includedSchemaSet = new Set();

// functions
const init = (_config, _loggingUtil) => {
  /* istanbul ignore if */
  if (_config === undefined) {
    throw new Error('config is required.');
  }
  /* istanbul ignore if */
  if (_loggingUtil === undefined) {
    throw new Error('loggingUtil is required.');
  };
  config = _config;
  loggingUtil = _loggingUtil;

  ready = false;

  mutex = new awaitSemaphore.Mutex();
  if (!fs.existsSync(config.ownerWalletDataDir)) {
    fs.mkdirSync(config.ownerWalletDataDir, {recursive: true});
  }
  // setTimeout(setWaxApiAndAddTemplates, 0);
};

const deactivate = () => {
  /* eslint-disable no-unused-vars */
  config = undefined;
  loggingUtil = undefined;
  mutex = undefined;
  /* eslint-enable no-unused-vars */
  templates.length = 0;
  ready = false;
};


const fetchWrapper = async (url, options) => {
  // loggingUtil.log('fetchWrapper', 'url', url);
  // loggingUtil.log('fetchWrapper', 'options', options);
  if (options == undefined) {
    options = {};
  }
  if (options.headers == undefined) {
    options.headers = {};
  }
  options.headers['Content-Type'] = 'application/json';
  const response = await fetch(url, options);
  const responseWrapper = {};
  responseWrapper.status = response.status;
  responseWrapper.json = async () => {
    const text = await response.text();
    if (text.startsWith('<')) {
      responseWrapper.status = 500;
      return {message: text};
    } else {
      // loggingUtil.log('fetchWrapper', 'status', response.status);
      // loggingUtil.log('fetchWrapper', 'text', text);
      return JSON.parse(text);
    }
  };
  return responseWrapper;
};

const getWaxApiUrl = () => {
  return randomUtil.getRandomArrayElt(config.atomicAssetsEndpointsV2);
};

const getWaxApi = (url) => {
  const waxApi = new ExplorerApi(url, 'atomicassets', {fetch: fetchWrapper});
  return waxApi;
};

const setWaxApiAndAddTemplates = async () => {
  const url = getWaxApiUrl();
  try {
    const waxApi = getWaxApi(url);
    await addAllTemplates(waxApi);
  } catch (error) {
    // console.trace(error);
    loggingUtil.log('INTERIM setWaxApiAndAddTemplates', url, error.message);
    setTimeout(setWaxApiAndAddTemplates, 1000);
    return;
  }
};

const addAllTemplates = async (waxApi) => {
  loggingUtil.log(dateUtil.getDate(), 'STARTED addAllTemplates');

  config.excludedTemplates.forEach((templateId) => {
    excludedTemplateSet.add(templateId);
  });

  config.includedSchemas.forEach((schemaId) => {
    includedSchemaSet.add(schemaId);
  });

  let page = 1;
  const max = config.maxTemplatesPerPage;

  const addTemplates = async () => {
    loggingUtil.log(dateUtil.getDate(), 'STARTED addTemplates page', page);
    let lessThanMax = false;
    try {
      const pageTemplates = await waxApi.getTemplates({'collection_name': 'crptomonkeys'}, page, max);
      lessThanMax = pageTemplates.length < max;
      loggingUtil.log(dateUtil.getDate(), 'INTERIM addTemplates page', page, pageTemplates.length, max);

      for (let pageTemplateIx = 0; pageTemplateIx < pageTemplates.length; pageTemplateIx++) {
        const pageTemplate = pageTemplates[pageTemplateIx];
        if (!excludedTemplateSet.has(pageTemplate.template_id)) {
          if (includedSchemaSet.has(pageTemplate.schema.schema_name)) {
            // loggingUtil.log(dateUtil.getDate(), 'STARTED addTemplates pageTemplate', pageTemplate);
            const pageTemplateData = {};
            pageTemplateData.template_id = pageTemplate.template_id;
            pageTemplateData.schema_name = pageTemplate.schema.schema_name;
            pageTemplateData.name = pageTemplate.immutable_data.name;
            pageTemplateData.img = pageTemplate.immutable_data.img;
            pageTemplateData.backimg = pageTemplate.immutable_data.backimg;
            pageTemplateData.issued_supply = parseInt(pageTemplate.issued_supply, 10);
            pageTemplateData.max_supply = parseInt(pageTemplate.max_supply, 10);
            pageTemplateData.rarity = pageTemplate.immutable_data.rarity.toLowerCase();
            // loggingUtil.log(dateUtil.getDate(), 'SUCCESS addTemplates pageTemplateData', pageTemplateData);
            templates.push(pageTemplateData);
          }
        }
      }

      if (lessThanMax) {
        loggingUtil.log(dateUtil.getDate(), 'SUCCESS addAllTemplates');
        setTimeout(cacheAllCardImages, 0);
      } else {
        loggingUtil.log(dateUtil.getDate(), 'SUCCESS addTemplates page', page);
        page++;
        setTimeout(addTemplates, 1000);
      }
    } catch (error) {
      loggingUtil.log(dateUtil.getDate(), 'INTERIM addTemplates page', page, error.message);
      setTimeout(addTemplates, 1000);
    }
  };
  addTemplates();
};


const cacheAllCardImages = async () => {
  loggingUtil.log(dateUtil.getDate(), 'STARTED cacheAllCardImages');
  const getFile = async (ipfs) => {
    const url = `https://ipfs.io/ipfs/${ipfs}`;
    const tempFileName = `static-html/ipfs/${ipfs}-temp.webp`;
    const fileName = `static-html/ipfs/${ipfs}.webp`;
    if (!fs.existsSync(fileName)) {
      return new Promise((resolve, reject) => {
        const shrink = () => {
          loggingUtil.log(dateUtil.getDate(), 'INTERIM cacheAllCardImages', 'shrink', fileName);
          sharp(tempFileName)
              .resize(265, 370)
              .toFile(fileName, (err, info) => {
                if (err != null) {
                  loggingUtil.log(dateUtil.getDate(), 'INTERIM cacheAllCardImages', 'err', err);
                }
                // loggingUtil.log(dateUtil.getDate(), 'INTERIM cacheAllCardImages', 'info', info);
                // fs.unlinkSync(tempFileName);
                resolve();
              });
        };
        request(url).pipe(fs.createWriteStream(tempFileName)).on('close', shrink);
      });
    }
  };

  for (let templateIx = 0; templateIx < templates.length; templateIx++) {
    loggingUtil.log(dateUtil.getDate(), 'INTERIM cacheAllCardImages', (templateIx+1), templates.length);
    const card = templates[templateIx];
    await getFile(card.img);

    // await getFile(card.backimg);
  }
  ready = true;
  loggingUtil.log(dateUtil.getDate(), 'SUCCESS cacheAllCardImages');
  setTimeout(thawAllAssetsIfItIsTime, 0);
};

const getTemplateCount = () => {
  return templates.length;
};

const getAssetOptions = (owner) => {
  return {'collection_name': 'crptomonkeys', 'owner': owner};
};

const hasOwnedCards = async (owner) => {
  const wallets = await loadWalletsForOwner(owner);
  for (let ix = 0; ix < wallets.length; ix++) {
    const url = getWaxApiUrl();
    const waxApi = getWaxApi(url);
    const wallet = wallets[ix];
    const assetOptions = getAssetOptions(wallet);
    const pageAssets = await waxApi.getAssets(assetOptions, 1, 1);
    if (pageAssets.length > 0) {
      return true;
    }
  }
  return false;
};

const isOwnerEligibleForGiveaway = async (owner) => {
  // is owner frozen card count over the config.minGiveawayBetCount
  // isOwnerFrozenCardCountOverMinGiveawayBetCount
  const ownedCards = await getOwnedCards(owner);
  let frozenCount = 0;
  for (let ownedCardIx = 0; ownedCardIx < ownedCards.length; ownedCardIx++) {
    const ownedCard = ownedCards[ownedCardIx];
    const assetId = ownedCard.asset_id;
    const isAssetFrozenFlag = await assetUtil.isAssetFrozen(assetId);
    if (isAssetFrozenFlag) {
      frozenCount++;
    }
    if (frozenCount >= config.minGiveawayBetCount) {
      // loggingUtil.log(dateUtil.getDate(), 'isOwnerEligibleForGiveaway', true, frozenCount, '>=', config.minGiveawayBetCount);
      return true;
    }
  }
  return false;
};

const getTotalActiveCardCount = () => {
  return timedCacheUtil.getCacheSize(ownerAssetCacheMap);
};

const getOwnedCards = async (owner) => {
  const getOwnedCardsCallback = () => {
    return getOwnedCardsToCache(owner);
  };
  return await timedCacheUtil.getUsingNamedCache('Owned Cards', ownerAssetCacheMap, owner,
      config.assetCacheTimeMs, getOwnedCardsCallback);
};

const getOwnedCardsToCache = async (owner) => {
  const allAssets = [];
  const wallets = await loadWalletsForOwner(owner);
  for (let ix = 0; ix < wallets.length; ix++) {
    const wallet = wallets[ix];
    const assetOptions = getAssetOptions(wallet);
    let page = 1;
    const assetsPerPage = config.maxAssetsPerPage;
    let moreAssets = true;
    while (moreAssets) {
      const url = getWaxApiUrl();
      // loggingUtil.log('getOwnedCardsToCache', 'url', url);
      const waxApi = getWaxApi(url);
      // console.log('owner', owner, 'page', page, allAssets.length);
      const pageAssets = await waxApi.getAssets(assetOptions, page, assetsPerPage);
      pageAssets.forEach((asset) => {
        // console.log('owner', owner, 'page', page, asset);
        const templateId = asset.template.template_id.toString();
        if (!excludedTemplateSet.has(templateId)) {
          if (includedSchemaSet.has(asset.schema.schema_name)) {
            allAssets.push(asset);
          }
        }
      });
      if (pageAssets.length < assetsPerPage) {
        moreAssets = false;
      }
      page++;
    }
  }
  return allAssets;
};

const getFrozenCount = async (ownedCards) => {
  let frozenCount = 0;
  for (let ownedCardIx = 0; ownedCardIx < ownedCards.length; ownedCardIx++) {
    const ownedCard = ownedCards[ownedCardIx];
    const assetId = ownedCard.asset_id;
    const isAssetFrozenFlag = await assetUtil.isAssetFrozen(assetId);
    if (isAssetFrozenFlag) {
      frozenCount++;
    }
  }
  return frozenCount;
};

const thawOwnerAssetsIfItIsTime = async (ownedCards, frozenCount) => {
  for (let ownedCardIx = 0; ownedCardIx < ownedCards.length; ownedCardIx++) {
    const ownedCard = ownedCards[ownedCardIx];
    const assetId = ownedCard.asset_id;
    await assetUtil.thawAssetIfItIsTime(assetId);
  }
};

const getPayoutInformation = async (owner) => {
  const resp = {};
  resp.cardCount = 0;
  resp.templateCount = templates.length;
  // loggingUtil.log(dateUtil.getDate(), 'STARTED countCards');
  const ownedCards = await getOwnedCards(owner);
  const frozenAssetByTemplateMap = {};
  const unfrozenAssetByTemplateMap = {};
  const ownedAssets = [];

  resp.ownedAssets = ownedAssets;
  resp.frozenAssetByTemplateMap = frozenAssetByTemplateMap;
  resp.unfrozenAssetByTemplateMap = unfrozenAssetByTemplateMap;

  const frozenCount = await getFrozenCount(ownedCards);
  await thawOwnerAssetsIfItIsTime(ownedCards, frozenCount);

  for (let ownedCardIx = 0; ownedCardIx < ownedCards.length; ownedCardIx++) {
    const ownedCard = ownedCards[ownedCardIx];
    const assetId = ownedCard.asset_id;
    const templateId = ownedCard.template.template_id.toString();
    const isAssetFrozenFlag = await assetUtil.isAssetFrozen(assetId);
    if (isAssetFrozenFlag) {
      if (frozenAssetByTemplateMap[templateId] === undefined) {
        frozenAssetByTemplateMap[templateId] = [];
      }
      frozenAssetByTemplateMap[templateId].push(assetId);
    } else {
      if (unfrozenAssetByTemplateMap[templateId] === undefined) {
        unfrozenAssetByTemplateMap[templateId] = [];
      }
      unfrozenAssetByTemplateMap[templateId].push(assetId);
    }
    const ownedAsset = {};
    ownedAsset.name = ownedCard.template.immutable_data.name;
    ownedAsset.img = ownedCard.template.immutable_data.img;
    ownedAsset.rarity = ownedCard.template.immutable_data.rarity;
    ownedAsset.maxSupply = parseInt(ownedCard.template.max_supply, 10);
    ownedAsset.assetId = assetId;
    ownedAsset.templateId = templateId;
    ownedAsset.frozen = isAssetFrozenFlag;
    ownedAsset.thawTimeMs = await assetUtil.getThawTimeMs(assetId);
    ownedAssets.push(ownedAsset);
  }
  // loggingUtil.log(dateUtil.getDate(), 'ownedCards', ownedCards);
  // loggingUtil.log(dateUtil.getDate(), 'ownedCardTemplateSet', ownedCardTemplateSet);
  for (let templateIx = 0; templateIx < templates.length; templateIx++) {
    const card = templates[templateIx];
    const hasCard = unfrozenAssetByTemplateMap[card.template_id] !== undefined;
    // loggingUtil.log(dateUtil.getDate(), 'template_id', card.template_id, 'hasCard', hasCard);
    if (hasCard) {
      resp.cardCount++;
    }
    // if (await atomicassetsUtil.ownerHasCard(owner, card.template_id)) {
    // resp.cardCount++;
    // }
  }
  // loggingUtil.log(dateUtil.getDate(), 'SUCCESS countCards');

  const winningOneCardOdds = resp.cardCount/resp.templateCount;
  const winningOdds = winningOneCardOdds;// * winningOneCardOdds * winningOneCardOdds;
  // const payoutAmountDenominator = winningOneCardOdds * winningOneCardOdds;

  if (winningOdds == 0) {
    resp.winningOdds = 0;
    resp.payoutAmount = 0;
  } else {
    resp.winningOdds = winningOdds;
    // resp.payoutAmount = parseInt((1./payoutAmountDenominator).toFixed(0), 10);
    resp.payoutAmount = 1;
  }

  // loggingUtil.log(dateUtil.getDate(), 'SUCCESS getPayoutInformation', resp);

  return resp;
};

const isReady = () => {
  return ready;
};

const getTemplates = () => {
  return templates;
};

const getActiveAccountList = () => {
  return [...ownerAssetCacheMap.keys()];
};

const getOwnerFile = (owner) => {
  if (owner === undefined) {
    throw new Error('account is required.');
  };

  const seedHash = crypto.createHash('sha256')
      .update(`${owner}`)
      .digest();
  const fileNm = seedHash.toString('hex') + '.json';

  return path.join(config.ownerWalletDataDir, fileNm);
};

const loadWalletsForOwner = async (owner) => {
  const mutexRelease = await mutex.acquire();
  try {
    const file = getOwnerFile(owner);
    if (!fs.existsSync(file)) {
      saveWalletsForOwnerInsideMutex(owner, [owner]);
    }
    const data = fs.readFileSync(file, 'UTF-8');
    const json = JSON.parse(data);
    return json.wallets;
  } finally {
    mutexRelease();
  }
  if (walletsForOwner.has(owner)) {
    return walletsForOwner.get(owner);
  } else {
    return [owner];
  }
};

const saveWalletsForOwnerInsideMutex = (owner, wallets) => {
  const file = getOwnerFile(owner);
  const filePtr = fs.openSync(file, 'w');
  fs.writeSync(filePtr, JSON.stringify({owner: owner, wallets: wallets}));
  fs.closeSync(filePtr);
};

const saveWalletsForOwner = async (owner, wallets) => {
  const mutexRelease = await mutex.acquire();
  try {
    saveWalletsForOwnerInsideMutex(owner, wallets);
  } finally {
    mutexRelease();
  }
};

const getOwnersWithWalletsList = async () => {
  const mutexRelease = await mutex.acquire();
  try {
    const owners = [];
    if (fs.existsSync(config.ownerWalletDataDir)) {
      const list = fs.readdirSync(config.ownerWalletDataDir);
      for (let ix = 0; ix < list.length; ix++) {
        const nm = list[ix];
        const file = path.join(config.ownerWalletDataDir, nm);
        const data = fs.readFileSync(file, 'UTF-8');
        const json = JSON.parse(data);
        owners.push(json.owner);
      }
    }
    return owners;
  } finally {
    mutexRelease();
  }
};

const sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const thawAllAssetsIfItIsTime = async () => {
  try {
    loggingUtil.log(dateUtil.getDate(), 'STARTED thawAllAssetsIfItIsTime');
    const owners = await getOwnersWithWalletsList();
    for (let ownerIx = 0; ownerIx < owners.length; ownerIx++) {
      if(ownerIx > 0) {
        await sleep(1000);
      }
      const owner = owners[ownerIx];
      const ownedCards = await getOwnedCards(owner);
      const frozenCount = await getFrozenCount(ownedCards);
      await thawOwnerAssetsIfItIsTime(ownedCards, frozenCount);
    }
    loggingUtil.log(dateUtil.getDate(), 'SUCCESS thawAllAssetsIfItIsTime');
  } catch (error) {
    loggingUtil.log(dateUtil.getDate(), 'FAILURE thawAllAssetsIfItIsTime');
    loggingUtil.trace(error);
  }
};

module.exports.init = init;
module.exports.deactivate = deactivate;
module.exports.getTemplateCount = getTemplateCount;
module.exports.hasOwnedCards = hasOwnedCards;
module.exports.getOwnedCards = getOwnedCards;
module.exports.getPayoutInformation = getPayoutInformation;
module.exports.isReady = isReady;
module.exports.getTemplates = getTemplates;
module.exports.getTotalActiveCardCount = getTotalActiveCardCount;
module.exports.getActiveAccountList = getActiveAccountList;
module.exports.loadWalletsForOwner = loadWalletsForOwner;
module.exports.saveWalletsForOwner = saveWalletsForOwner;
module.exports.isOwnerEligibleForGiveaway = isOwnerEligibleForGiveaway;
module.exports.getOwnersWithWalletsList = getOwnersWithWalletsList;
module.exports.setWaxApiAndAddTemplates = setWaxApiAndAddTemplates;
