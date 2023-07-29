import fs from 'fs/promises'
import { spawn } from 'child_process'
import from from '@adamburgess/linq'
import { join } from 'path'
import frontMatter from 'front-matter'
import { applyDiff } from './apply-diff.js'
import { promise as readdirp } from 'readdirp'

async function git(args: string[], date?: string) {
    console.log('$ git', ...args);
    let env = { ...process.env };
    if (date) {
        args[args.length - 1] = `${date}: ${args[args.length - 1]}`;
        const [day, month, year] = date.split('/');
        if (parseInt(year) < 1970) date = '1970-01-01'; // :(
        else date = `${year}-${month}-${day}`;
        env.GIT_COMMITTER_DATE = env.AUTHOR_DATE = `${date} 10:00:00 +1000`;
    }
    const g = spawn('git', args, { stdio: 'inherit', env });
    await new Promise<void>((resolve, reject) => {
        g.on('close', code => {
            if (code !== 0) reject(code);
            resolve();
        });
    });
}

// Create a new git repo and add the README_main.md to the main branch.
await fs.rm('git-output', { recursive: true, force: true });
await fs.mkdir('git-output');
process.chdir('git-output');
await fs.copyFile('../README_main.md', 'README.md');
await git(['init']);
await git(['branch', '-M', 'main']);
await git(['add', 'README.md']);
await git(['commit', '-m', 'Add Readme']);

// Add the constitution.md
const constititionFilename = 'The Constitution of Australia.md';
await fs.copyFile('../referendums/1899/00-constitution/constitution.md', constititionFilename);
await git(['add', '-A']);
await git(['commit', '-m', 'Commonwealth of Australia Constitution Act (The Constitution)'], '01/01/1901');

// Go through each referendum, creating a branch for each and applying the patch.
//  todo: create a github pr.
// If the referendum is carried, ffw merge the main branch to it.
// Otherwise leave it be.

//const refDirs = (await fs.readdir('../referendums', { recursive: true, withFileTypes: true }))
//    .filter(dir => dir.isDirectory())
//    .map(dir => join(dir.path, dir.name));
const refDirs = (await readdirp('../referendums', { type: 'directories' }))
    .map(d => join('../referendums', d.path));

const referendumDirs = from(refDirs)
    .where(dir => !dir.includes('1899') && dir.split('/').length === 4)
    .orderBy(dir => dir);

let branches: string[] = [];
for (const dir of referendumDirs) {
    const infoMd = await fs.readFile(join(dir, 'info.md'), 'utf8');
    const info = frontMatter(infoMd).attributes as { outcome: 'carried' | 'rejected' | 'pending' };

    if (info.outcome !== 'carried') continue;

    const branchName = dir.split('/').at(-1)!;
    branches.push(branchName);


    await git(['switch', '-c', branchName]);
    const diff = await fs.readFile(join(dir, 'changes.diff'), 'utf8');
    await fs.writeFile(constititionFilename, applyDiff(await fs.readFile(constititionFilename, 'utf8'), diff));
    await git(['commit', '-am', branchName]);

    // swap back to main..
    await git(['switch', 'main']);
}

// Push all.

await git(['remote', 'add', 'origin', 'ssh://git@git.adam.id.au:222/adamburgess/australian-constitution.git'])
//await git(['push', '-u', 'origin', '-f', 'main', ...branches]);
