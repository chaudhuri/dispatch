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

// in this file a lot should be added; for example, verifying that all things refered in the sequence are of the same language (check first if this is what we want?)
// for now only check that the the object has the correct attributes (without checking the types of their values)

import crypto from "crypto";
import os from "os";
import fs from "node:fs/promises";
import path from "path";
import cp from "child_process";
import util from "util";
import fetch from "node-fetch";
import { Web3Storage } from "web3.storage";
import { CarReader } from "@ipld/car";

import { config, keyStore, allowList } from "./initial-vals.js";

function isAnnotated(format: string,
                     testFn: (obj: any) => boolean) {
    const annotatedFormat = "annotated-" + format;
    return async (obj: any) => {
        return Object.keys(obj).length === 3
            && "format" in obj
            && obj["format"] === annotatedFormat
            && format in obj
            && testFn(await ipfsGetObj(obj[format]["/"]));
    };
}

export function isContext(obj: any) {
    return Object.keys(obj).length === 3
        && "format" in obj
        && obj["format"] === "context"
        && "language" in obj
        && "content" in obj;
}

export const isAnnotatedContext = isAnnotated("context", isContext);

export function isFormula(obj: any) {
    return Object.keys(obj).length === 4
        && "format" in obj
        && obj["format"] === "formula"
        && "language" in obj
        && "content" in obj
        && "context" in obj;
}

export const isAnnotatedFormula = isAnnotated("formula", isFormula);

export function isSequent(obj: any) {
    return Object.keys(obj).length === 3
        && "format" in obj
        && obj["format"] === "sequent"
        && "dependencies" in obj
        && "conclusion" in obj;
}

export const isAnnotatedSequent = isAnnotated("sequent", isSequent);

export function isTool(obj: any) {
    return Object.keys(obj).length === 2
        && "format" in obj
        && obj["format"] === "tool"
        && "content" in obj;
}

export function isLanguage(obj: any) {
    return Object.keys(obj).length === 2
        && "format" in obj
        && obj["format"] === "language"
        && "content" in obj;
}

export function isProduction(obj: any) {
    return Object.keys(obj).length === 3
        && "format" in obj
        && obj["format"] === "production"
        && "sequent" in obj
        && "mode" in obj;
}

export const isAnnotatedProduction = isAnnotated("production", isProduction);

export function isAssertion(obj: any) {
    return Object.keys(obj).length === 4
        && "format" in obj
        && obj["format"] === "assertion"
        && "agent" in obj
        && "claim" in obj
        && "signature" in obj;
}

export function isCollection(obj: any) {
    return Object.keys(obj).length === 3
        && "format" in obj
        && obj["format"] === "collection"
        && "name" in obj
        && "elements" in obj;
}

// the standard format types to publish and get
export async function isOfSpecifiedTypes(obj: any) {
    return isContext(obj)
        || isFormula(obj)
        || isSequent(obj)
        || isProduction(obj)
        || isAssertion(obj)
        || isCollection(obj)
        || await isAnnotatedContext(obj)
        || await isAnnotatedFormula(obj)
        || await isAnnotatedSequent(obj)
        || await isAnnotatedProduction(obj);
}

export function isValidSignature(assertion: any): boolean {
    // [TODO] assert(isAssertion(assertion));
    const pubKey = crypto.createPublicKey(assertion["agent"]);
    const data = Buffer.from(assertion["claim"]["/"]);
    const sig = Buffer.from(assertion["signature"], "hex");
    return crypto.verify(null, data, pubKey, sig);
}

export async function fingerPrint(agent: string) {
    let fingerPrint: string = await keyStore.read(agent);
    if (!fingerPrint) {
        fingerPrint = crypto.createHash('sha256').update(agent).digest('hex');
        await keyStore.write(agent, fingerPrint);
    }
    return fingerPrint;
}

export async function isAllowed(agent: string) {
    const list: [string] = await allowList.read("list");
    return list.includes(agent);
}

// --------------------------
// for retrieval from ipfs
// --------------------------

const exec = util.promisify(cp.exec);

export async function ipfsGetObj(cid: string) {
    const cmd = `ipfs dag get ${ cid }`;
    const dag = await exec(cmd);
    return JSON.parse(dag.stdout);
}

async function withTempFile<A>(ext: string,
                               fn: (fileName: string) => Promise<A>)
{
    const tmpDirPrefix = path.join(await fs.realpath(os.tmpdir()), "dispatch-");
    const tmpDir = await fs.mkdtemp(tmpDirPrefix);
    const tmpFile = path.join(tmpDir, `file.${ ext }`);
    try {
        return await fn(tmpFile);
    } finally {
        await fs.rm(tmpDir, { recursive: true });
    }
}

export async function ensureFullDAG(cid: string) {
    try {
        // test if it exists locally or tries to retrieve the missing links in
        // case the ipfs daemon is activated
        const cmd = `ipfs dag export ${ cid }`;
        // [HACK] for now: causes a problem if we use an address with slashes
        // since ipfs export doesn't support it currently
        const ret = await exec(cmd);
        // fails if there are missing links from the local ipfs repo or
        // unsuccessful to retrieve in case the ipfs daemon is activated
        console.log(`DEBUG: ensureFullDAG(${ cid }):`);
        console.log(`DEBUG:   returned a CAR ${ ret.stdout.length }b long`);
    } catch (err) {
        console.log(`DEBUG: ensureFullDAG(${ cid }):`);
        console.log("DEBUG:   ipfs dag export failed");
        console.log(`DEBUG:   ${ err }`);
        const gateway = config.read("my-gateway");
        if (!gateway) {
            console.error("ERROR: unknown gateway (while trying to retrieve data");
            console.error(`Consider running ${ process.argv0 } set-gateway`);
            throw new Error("unknown gateway");
        }
        const url = `${ gateway }/api/v0/dag/export?arg=${ cid }`;
        console.log(`DEBUG: ensureFullDAG(${ cid }):`);
        console.log(`DEBUG:   url = ${ url }`);
        const response = await fetch(url);
        if (!response.ok)
            throw new Error(`unexpected response: ${ response.statusText }`);
        await withTempFile("car", async (tmpFile) => {
            await fs.writeFile(tmpFile, response.body);
            await exec(`ipfs dag import ${ tmpFile }`);
            console.log(`DEBUG: ensureFullDAG(${ cid }):`);
            console.log(`DEBUG:   via ${ url }`);
            console.log(`DEBUG:   returned a CAR ${ await fs.stat(tmpFile) }b long`);
        });
    }
}

// --------------------------
// for adding to ipfs (+cloud)
// --------------------------

export async function ipfsAddObj(obj: any): Promise<string> {
    return await withTempFile("json", async (tmpFile) => {
        await fs.writeFile(tmpFile, JSON.stringify(obj));
        const cmd = `ipfs dag put ${ tmpFile } --pin`;
        const ret = await exec(cmd, { encoding: "utf-8" });
        return ret.stdout.trim(); // this is the cid
    });
}

export async function publishDAGToCloud(cid: string) {
    const token: string = await config.read("my-web3.storage-api-token");
    if (!token || token === "**insert your token here**")
        throw new Error(`ERROR: missing web3.token; use ${ process.argv0 } set-web3token`);
    const client = new Web3Storage({ token });
    // [TODO] try to do this without temporary files
    await withTempFile("car", async (tmpFile) => {
        await exec(`ipfs dag export ${ cid } > ${ tmpFile }`);
        // read and parse the entire stream in one go, this will cache the contents of
        // the car in memory so is not suitable for large files.
        const contents = await fs.readFile(tmpFile);
        const reader = await CarReader.fromBytes(contents);
        await client.putCar(reader);
        // console.log(`DEBUG: publishDAGToCloud(${ cid })`);
        // console.log("DEBUG:   successful");
    });
}

// -------------------------------------------
// writing files after ensuring dirname exists
// -------------------------------------------

export async function writeFileIn(dirName : string, fileName : string,
                                  data : any) {
    try {
        const dir = await fs.opendir(dirName);
        await dir.close();
    } catch {
        await fs.mkdir(dirName, { recursive: true });
    }
    const finalFile = path.join(dirName, fileName);
    await fs.writeFile(finalFile, data);
    return finalFile;
}
