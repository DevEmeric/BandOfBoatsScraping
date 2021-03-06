/**
 * @author Benoit Fillon (www.skillvalue.com)
 */


const d3 = require('d3');
const fs = require('fs');
const stdio = require('stdio');
const axios = require('axios');
const cheerio = require('cheerio');

let boatsToBeProcessed = [];
let processedBoats = [];
let processedVendors = [];
let processedVendorsResult = [];

const baseUrl = 'https://www.bandofboats.com';
const defaultWaitTimeInMs = 1000;

/** Command line params definition */ 
var ops = stdio.getopt({
	csvFile: {description: 'Input : CSV File Name', key: 'c', args: 1, mandatory: true},
	boatsFile: {description: 'Output : json result file for Boats - overwritten if exists', key: 'b', args: 1, mandatory: false},
	vendorsFile: {description: 'Output : json result file for vendors - overwritten if exists', key: 'v', args: 1, mandatory: false}
});

/** Check if input file exists */
try {
    if (fs.existsSync(ops.csvFile)) {
        ProcessCSVFile(ops.csvFile);
    } else {
        console.error('Input File does not exist: ' + ops.csvFile)
    }
} catch(err) {
  console.error(err)
}

/**  Process Input CSV File 
 *   Manages reading input file, slicing in multiple lines and writing results
 *   @filename {string} fileName provided / needs to be a CSV file
*/
async function ProcessCSVFile(filename) {
    console.log('Processing... : ' + filename);

    var raw = fs.readFileSync(filename, 'utf8');
    boatsToBeProcessed = d3.csvParse(raw);
    let numberOfBoatsToBeProcessed = boatsToBeProcessed.length;
    let numberOfBoatsAlreadyProcessed = d3.csvParse(raw).filter(function(value) { return value.done === 'Y' }).length;
    console.log('Total # of boats to be processed : ' + boatsToBeProcessed.length);

    var pbar = stdio.progressBar(boatsToBeProcessed.length, 1);
    pbar.onFinish(function () {
        console.log('# of boats in input file : ' + numberOfBoatsToBeProcessed);
        console.log('# of boats in input file marked as already processed : ' + numberOfBoatsAlreadyProcessed);
        console.log('# of processed boats in output file : ' + processedBoats.length);

        if (processedBoats.length != boatsToBeProcessed.length) {
            if (numberOfBoatsToBeProcessed != processedBoats.length + numberOfBoatsAlreadyProcessed) {
                console.error('Numbers don\'t match: ' + numberOfBoatsToBeProcessed + ' != ' + processedBoats.length + ' + ' + numberOfBoatsAlreadyProcessed);
                console.error("ERROR: Some boats have not been properly processed!");
            } else {
                console.log('Numbers match: ' + numberOfBoatsToBeProcessed + ' = ' + processedBoats.length + ' + ' + numberOfBoatsAlreadyProcessed);
            }
        }
        let data = JSON.stringify(processedBoats);  
        fs.writeFileSync(ops.boatsFile, data, {encoding:'utf8',flag:'w+'}); 

        data = JSON.stringify(processedVendorsResult);  
        fs.writeFileSync(ops.vendorsFile, data, {encoding:'utf8',flag:'w+'}); 

        data = JSON.stringify(boatsToBeProcessed);  
        fs.writeFileSync(ops.csvFile + '.updated', data, {encoding:'utf8',flag:'w+'}); 
        
        console.log('DONE!!! (Please review results if errors have been thrown during execution!)');
    });

    for (i = 0; i < boatsToBeProcessed.length; i++) {
        if (boatsToBeProcessed[i].done != 'Y') {
            await getDataForASingleBoat(boatsToBeProcessed[i].link, i);
            await sleep(defaultWaitTimeInMs);
        }
        pbar.tick();
    }
}

/**  Process Input CSV File 
 *   Core business of the scraping process for a boat
 *   @url {string} URL of the boat to be scraped
 *   @i {number} line number of the boat in the orignal CSV file
*/
async function getDataForASingleBoat (url, i) {
    await axios.get(url)
    .then((response) => {
        if(response.status === 200) {
            var timestamp = Date.now();

            html = response.data;
            $ = cheerio.load(html); 
            
            let keyCars = [];
            let categories = [];

            let yearOfConstruction = $('span[data-cash-sentinel="boat-year"]').text().trim();
            let description = $('div[id="textDescription"]').text().trim();

            // Check that some "Caractéristiques clés" are available for this boat
            if ($('span[class="titleKey"]', 'div[id="description"]').text() == "Caractéristiques clés") {
                
                $('ul[class="lstDetails"]', 'div[id="description"]').find('li').each(function(i, elem){
                    let key = $(elem.childNodes[0]).text().trim();
                    if (key.endsWith(':')) {
                        key = key.substring(0, key.length-1);
                    } 

                    let value = $(elem.childNodes[1]).text().trim();
                    let detail = { key, value };
                    
                    keyCars.push(detail);

                }); 
            };

            // Check if "Inventaire" is available for this boat
            $('div[class="blockCateg"]', 'div[id="detailed_inventory"]').each(function(i, elem) {
                let titleCategory = $(elem).find('div[class="titleCateg"]').text().trim();
                let details = [];

                $(elem).find('ul[class="lstDetails"]').find('li').each(function(i, elem){
                    let key = $(elem.childNodes[0]).text().trim();
                    if (key.endsWith(':')) {
                        key = key.substring(0, key.length-1);
                    } 

                    let value = $(elem.childNodes[1]).text().trim();
                    let detail = { key, value };
                    
                    details.push(detail);

                });

                let category = {
                    titleCategory,
                    details
                }

                categories.push(category);
            });
            
            

            // Getting vendorUrl and then browsing to it
            let vendorUrl = "";
            if ($('a[class="fap-link"]', 'div[class="sold"]').length === 1) {
                vendorUrl = baseUrl + $('a[class="fap-link"]', 'div[class="sold"]')[0].attribs.href;
            };
            
            boat = {
                i,
                url,
                yearOfConstruction,
                description,
                timestamp,
                keyCars,
                categories,
                vendorUrl
            } 

            processedBoats.push(boat);
            boatsToBeProcessed[i].done = 'Y';
            boatsToBeProcessed[i].timestamp = timestamp;
            
            return vendorUrl;
            
        }
    }, 
        (error) => console.log(error)
    ).then((vendorUrl) => {
        if (vendorUrl != "") {
            getDataForBoatVendor(vendorUrl);
        }
    },
        (error) => console.log(error)
    );
} 

/**  Process Input CSV File 
 *   Core business of the scraping process for a boat
 *   @url {string} URL of the vendor to be scraped
*/
async function getDataForBoatVendor (url) {

    if (processedVendors.find((elem) => { return elem == url; }) == undefined) {
        processedVendors.push(url);

        await sleep(defaultWaitTimeInMs);
        await axios.get(url)
        .then((response) => {
            if(response.status === 200) {
                html = response.data;
                $ = cheerio.load(html); 

                // Getting vendor name and address info
                if ($('div[class="oneCardPro"]').length === 1) {
                    name = $('h2', 'div[class="oneCardPro"]').text().trim();
                    address = $('p[class="address"]', 'div[class="oneCardPro"]').text().trim();
                    fullcity = $('p[class="city"]', 'div[class="oneCardPro"]').text().trim();
                    zipcode = $('span', 'p[class="city"]').text().trim();
                    city = fullcity.replace(zipcode, '').trim();
                    country = $('p[class="country"]', 'div[class="oneCardPro"]').text().trim();
                }

                // Getting vendor coordinates
                if ($('div[id="map"]').length === 1) {
                    coordinates = $('div[id="map"]')[0].attribs["data-coordinates"];
                    let coordinatesDetails = coordinates.replace('(', '').replace(')', '').split(',');
                    longitude = coordinatesDetails[0];
                    latitude = coordinatesDetails[1];
                }

                // Getting phone number if it exists
                if ($('a[id="btnCallOffice"]').length === 1) {
                    phone = $('a[id="btnCallOffice"]')[0].attribs.rel;
                }
                
                // Getting email if it exists
                if ($('a[id="btnEmailOffice"]').length === 1) {
                    mail = $('a[id="btnEmailOffice"]')[0].attribs.rel;
                }

                description = $('div[class="description"]', 'div[class="container"]').text().trim();

                vendor = {
                    url,
                    name,
                    description,
                    address,
                    zipcode,
                    city,
                    country,
                    longitude,
                    latitude,
                    phone,
                    mail
                }

                processedVendorsResult.push(vendor);
            }
        }, 
            (error) => console.log(error)
        );
    }
} 

/** 
 * Function to wait a given amount of time between clicks
 * @ms {number} number of milliseconds to wait before waking up
 */
function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}