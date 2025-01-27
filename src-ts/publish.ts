/*
 * Copyright (C) 2023  Inria
 *
 * Inria: Institut National de Recherche en Informatique et en Automatique
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * A copy of the license is provided in the file "LICENSE" distributed
 * with this file. You may also obtain a copy of the License at:
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from "node:fs/promises";
import crypto from "crypto";

import iv from "./initial-vals.js";
import { ipfsAddObj, publishDAGToCloud } from "./utilities.js";


let readLanguages = {}
let readTools = {}
let readAgents = {}

export async function publishCommand(inputPath: string, target: target) {
    const data = await fs.readFile(inputPath, { encoding: "utf-8" });
    const input = JSON.parse(data);

    // publish contexts first (because they need to be linked in formulas)
    // consider an entry in "contexts" (like "fib": ..) in the input file to have two possible values: either [string] or ["damf:cidcontextobjcet"]
    // publish according to "format" in the given input file, first we consider the "sequence" format

    // considering the "format" attribute to be fixed (exists all the time) for all the possible input-formats (considering that input-formats might differ according to format of published objects)
    let format = input["format"]
    let cid = ""
    // SHOULD [TODO] check here if input-format is valid

    if (format == "context") {
        // only one context object exists in this case
        let contextObj = input["context"]
        cid = await publishContext(contextObj)
        console.log("published context object of cid: " + cid)
    }
    else if (format == "annotated-context") {
        let annotatedContextObj = input["annotated-context"]
        cid = await publishAnnotatedContext(annotatedContextObj)
        console.log("published annotated context object of cid: " + cid)
    }
    else if (format == "formula") {
        let formulaObj = input["formula"]
        cid = await publishFormula(formulaObj, input, {})
        console.log("published formula object of cid: " + cid)
    }
    else if (format == "annotated-formula") {
        let annotatedFormulaObj = input["annotated-formula"]
        cid = await publishAnnotatedFormula(annotatedFormulaObj, input, {})
        console.log("published annotated formula object of cid: " + cid)
    }
    else if (format == "sequent") {
        let sequentObj = input["sequent"]
        cid = await publishSequent(sequentObj, input, {})
        console.log("published sequent object of cid: " + cid)
    }
    else if (format == "annotated-sequent") {
        let annotatedSequentObj = input["annotated-sequent"]
        cid = await publishAnnotatedSequent(annotatedSequentObj, input, {})
        console.log("published annotated sequent object of cid: " + cid)
    }
    else if (format == "production") {
        let productionObj = input["production"]
        cid = await publishProduction(productionObj, input, {})
        console.log("published production object of cid: " + cid)
    }
    else if (format == "annotated-production") {
        let annotatedProductionObj = input["annotated-production"]
        cid = await publishAnnotatedProduction(annotatedProductionObj, input, {})
        console.log("published annotated production object of cid: " + cid)
    }
    else if (format == "assertion") {
        let assertionObj = input["assertion"]
        cid = await publishAssertion(assertionObj, input, {})
        console.log("published assertion object of cid: " + cid)
    }
    else if (format == "collection") { // collection of links to global objects
        let name = input["name"]
        let elements = input["elements"]
        cid = await publishCollection(name, elements, input, {})
        console.log("published collection object of cid: " + cid)
    }
    else throw new Error(`unknown input format ${format}`);

    // if "target" is cloud (global), publish the final sequence cid (dag) through the web3.storage api
    if (cid != "" && target == "cloud") {
        await publishDAGToCloud(cid)
    }
}

// !!! should add more safety checks - do later (for all the publishing functions)
let publishContext = async (contextObj: {}) => {
    // consider an entry in "context" (like "fib": ..) in the input file to have two possible values: either [string] or "damf:ciddeclarationobject"
    // use ipfsAddObj to add the context and object
    let language = contextObj["language"]
    let content = contextObj["content"]

    let cidLanguage = "", cidContext = ""

    if (typeof language == "string" && language.startsWith("damf:"))
        cidLanguage = language.split(":")[1]
    else {
        // assuming the cids in languages are of "format"="language" --> check later
        if (readLanguages[language]) { cidLanguage = readLanguages[language] }
        else {
            cidLanguage = (await iv.languages.read(language))["language"];
            readLanguages[language] = cidLanguage
        }
    }


    let contextGlobal: context = {
        "format": "context",
        "language": { "/": cidLanguage },
        "content": content
    }

    let cidObj = await ipfsAddObj(contextGlobal)
    cidContext = cidObj

    return cidContext
}

let publishAnnotatedContext = async (annotatedContextObj: {}) => {
    let context = annotatedContextObj["context"]
    let annotation = annotatedContextObj["annotation"]

    let cidContext = ""

    if (typeof context == "string" && context.startsWith("damf:"))
        cidContext = context.split(":")[1]
    else {
        cidContext = await publishContext(context)
    }


    let annotatedContextGlobal: annotatedContext = {
        "format": "annotated-context",
        "context": { "/": cidContext },
        "annotation":  annotation
    }

    let cid = await ipfsAddObj(annotatedContextGlobal)

    return cid
}

let publishFormula = async (formulaObj: {}, input: {}, publishedContexts: {}) => {
    let language = formulaObj["language"]
    let content = formulaObj["content"]
    let cidLanguage = ""

    if (typeof language == "string" && language.startsWith("damf:"))
        cidLanguage = language.split(":")[1]
    else {
        // assuming the cids in languages are of "format"="language" --> check later
        if (readLanguages[language]) { cidLanguage = readLanguages[language] }
        else {
            cidLanguage = (await iv.languages.read(language))["language"];
            readLanguages[language] = cidLanguage
        }
    }

    let contextNames = formulaObj["context"]
    let contextLinks = [] as ipldLink[]

    for (let contextName of contextNames) {
        let contextCid = ""
        if (publishedContexts[contextName]) {
            contextCid = publishedContexts[contextName]
        }
        else if (contextName.startsWith("damf:"))
            contextCid = contextName.split(":")[1]
        else {
            contextCid = await publishContext(input["contexts"][contextName])
            publishedContexts[contextName] = contextCid
        }
        contextLinks.push({ "/": contextCid })
    }


    let formulaGlobal: formula = {
        "format": "formula",
        "language": { "/": cidLanguage },
        "content": content,
        "context": contextLinks
    }

    let cid = await ipfsAddObj(formulaGlobal)

    return cid

}

// change into annotated -> ...
let publishAnnotatedFormula = async (annotatedFormulaObj: {}, input: {}, publishedContexts: {}) => {
    let formula = annotatedFormulaObj["formula"]
    let annotation = annotatedFormulaObj["annotation"]

    let cidFormula = ""

    if (typeof formula == "string" && formula.startsWith("damf:"))
        cidFormula = formula.split(":")[1]
    else {
        cidFormula = await publishFormula(formula, input, publishedContexts)
    }


    let annotatedFormulaGlobal: annotatedFormula = {
        "format": "annotated-formula",
        "formula": { "/": cidFormula },
        "annotation": annotation
    }

    let cid = await ipfsAddObj(annotatedFormulaGlobal)

    return cid
}

let publishSequent = async (sequentObj: {}, input: {}, publishedContexts: {}) => {

    let conclusionName = sequentObj["conclusion"]
    let cidConclusion = ""

    if (conclusionName.startsWith("damf:"))
        cidConclusion = conclusionName.split(":")[1]
    else {
        let conclusionObj = input["formulas"][conclusionName]

        cidConclusion = await publishFormula(conclusionObj, input, publishedContexts)
    }

    let dependenciesNames = sequentObj["dependencies"]
    let dependenciesIpfs = [] as ipldLink[]
    for (let dependency of dependenciesNames) {
        let ciddependency = ""
        if (dependency.startsWith("damf:")) {
            // assuming the cids in "lemmas" should refer to a "formula" object
            //(if we remove the .thc generation and replace it with generation of the output format.json file produced by dispatch get)
            ciddependency = dependency.split(":")[1]
            // should we test that the cid refers to a formula object here? (check later where it's best to do the cid objects type checking?)
        }
        else {
            let dependencyObj = input["formulas"][dependency]
            ciddependency = await publishFormula(dependencyObj, input, publishedContexts)
        }
        dependenciesIpfs.push({ "/": ciddependency })
    }

    let sequentGlobal = {
        "format": "sequent",
        "dependencies": dependenciesIpfs,
        "conclusion": { "/": cidConclusion }
    }

    let cid = await ipfsAddObj(sequentGlobal)

    return cid

}

let publishAnnotatedSequent = async (annotatedSequentObj: {}, input: {}, publishedContexts: {}) => {
    let sequent = annotatedSequentObj["sequent"]
    let annotation = annotatedSequentObj["annotation"]

    let cidSequent = ""

    if (typeof sequent == "string" && sequent.startsWith("damf:"))
        cidSequent = sequent.split(":")[1]
    else {
        cidSequent = await publishSequent(sequent, input, publishedContexts)
    }


    let annotatedSequentGlobal: annotatedSequent = {
        "format": "annotated-sequent",
        "sequent": { "/": cidSequent },
        "annotation": annotation
    }

    let cid = await ipfsAddObj(annotatedSequentGlobal)

    return cid
}

// [TODO] Remove the mode/modeValue distinction.
//        (already caused at least one bug)
let publishProduction = async (productionObj: {}, input: {}, publishedContexts: {}) => {
    let mode = productionObj["mode"]
    let sequent = productionObj["sequent"]
    let modeValue: toolLink | null | "axiom" | "conjecture" = null // the currently expected mode values
    let cidTool = "", cidSequent = ""

    // add spec and checks later that sequent is "damf:.." or {..}
    if (typeof sequent == "string" && sequent.startsWith("damf:"))
        cidSequent = sequent.split(":")[1]
    else cidSequent = await publishSequent(sequent, input, publishedContexts)

    // these are just the CURRENTLY known production modes to dispatch
    // but later, maybe this would be extended : the important point is
    //that tools that publish and get global objects have some expected modes,
    //according to some specification (maybe standard maybe more)
    // OR maybe make it more general? --> dispatch doesn't check restricted mode values?
    if (mode == null || mode == "axiom" || mode == "conjecture") {
        modeValue = mode
    }

    // other than the expected modes keywords, the current specification of a production,
    // and what dispatch expects is a "tool" format cid (either directly put in the input
    //as damf:cid or through a profile name which is specific to dispatch
    //(but the end result is the same, which is the cid of the tool format object))
    else if (typeof mode == "string" && mode.startsWith("damf:")) {
        cidTool = mode.split(":")[1]
        modeValue = { "/": cidTool }
    }
    else {
        // assuming the cids in toolProfiles are of "format"="tool" --> check later
        if (readTools[mode]) { cidTool = readTools[mode] }
        else {
            cidTool = (await iv.toolProfiles.read(mode))["tool"];
            readTools[mode] = cidTool
        }

        modeValue = { "/": cidTool }
    }

    let productionGlobal: production = {
        "format": "production",
        "sequent": { "/": cidSequent },
        "mode": modeValue
    }

    let cidProduction = await ipfsAddObj(productionGlobal)

    return cidProduction
}

let publishAnnotatedProduction = async (annotatedProductionObj: {}, input: {}, publishedContexts: {}) => {
    let production = annotatedProductionObj["production"]
    let annotation = annotatedProductionObj["annotation"]

    let cidProduction = ""

    if (typeof production == "string" && production.startsWith("damf:"))
        cidProduction = production.split(":")[1]
    else {
        cidProduction = await publishProduction(production, input, publishedContexts)
    }


    let annotatedProductionGlobal: annotatedProduction = {
        "format": "annotated-production",
        "production": { "/": cidProduction },
        "annotation": annotation
    }

    let cid = await ipfsAddObj(annotatedProductionGlobal)

    return cid
}

// refer to either production or annotatedproduction. how
let publishAssertion = async (assertionObj: {}, input: {}, publishedContexts: {}) => {
    let agentProfileName = assertionObj["agent"]
    let claim = assertionObj["claim"]
    let cidClaim = ""

    if (typeof claim == "string" && claim.startsWith("damf:"))
        cidClaim = claim.split(":")[1]
    else {
        // should do additional checking
        if (claim["format"] == "production") {
            cidClaim = await publishProduction(claim["production"], input, publishedContexts)
        }
        else if (claim["format"] == "annotated-production") {
            let production = claim["production"]
            let annotation = claim["annotation"]

            let annotatedProductionObj = {
                "production": production,
                "annotation": annotation
            }
            cidClaim = await publishAnnotatedProduction(annotatedProductionObj, input, publishedContexts)
        }
    }

    let agentProfile = {}
    if (readAgents[agentProfileName]) { agentProfile = readAgents[agentProfileName] }
    else {
        agentProfile = (await iv.agentProfiles.read(agentProfileName));
        readAgents[agentProfileName] = agentProfile
    }
    const priKey = crypto.createPrivateKey(agentProfile["private-key"]);
    const signature = crypto.sign(null, Buffer.from(cidClaim), priKey).toString("hex");

    const assertionGlobal: assertion = {
        "format": "assertion",
        "agent": agentProfile["public-key"],
        "claim": { "/": cidClaim },
        "signature": signature
    }

    const cidAssertion = await ipfsAddObj(assertionGlobal)

    return cidAssertion
}

// also needs more checking
let publishGeneric = async (element: {}, input: {}, publishedContexts: {}) => {
    let cid = ""
    let actualElement = element["element"]
    if (element["format"] == "context")
        cid = await publishContext(actualElement)
    else if (element["format"] == "annotated-context")
        cid = await publishAnnotatedContext(actualElement)
    else if (element["format"] == "formula")
        cid = await publishFormula(actualElement, input, publishedContexts)
    else if (element["format"] == "annotated-formula")
        cid = await publishAnnotatedFormula(actualElement, input, publishedContexts)
    else if (element["format"] == "sequent")
        cid = await publishSequent(actualElement, input, publishedContexts)
    else if (element["format"] == "annotated-sequent")
        cid = await publishAnnotatedSequent(actualElement, input, publishedContexts)
    else if (element["format"] == "production")
        cid = await publishProduction(actualElement, input, publishedContexts)
    else if (element["format"] == "annotated-production")
        cid = await publishAnnotatedProduction(actualElement, input, publishedContexts)
    else if (element["format"] == "assertion")
        cid = await publishAssertion(actualElement, input, publishedContexts)
    return cid
}

let publishCollection = async (name: string, elements: [], input: {}, publishedContexts: {}) => {
    let elementsLinks = []
    for (let element of elements) {
        let cidElement = await publishGeneric(element, input, publishedContexts)
        elementsLinks.push({ "/": cidElement })
    }

    let collectionGlobal = {
        "format": "collection",
        "name": name,
        "elements": elementsLinks
    }

    let cidCollection = await ipfsAddObj(collectionGlobal)

    return cidCollection
}
