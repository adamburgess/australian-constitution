import fs from 'fs/promises'
import { spawn } from 'child_process'
import from from '@adamburgess/linq'
import { join } from 'path'
import frontMatter from 'front-matter'
import { applyDiff } from './apply-diff.js'
import { promise as readdirp } from 'readdirp'
import moment from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import utc from 'dayjs/plugin/utc'
moment.extend(customParseFormat);
moment.extend(isSameOrAfter);
moment.extend(utc);

function sanitiseGitDate(date: string | undefined) {
    if (!date) return undefined;
    const [day, month, year] = date.split('/');
    if (parseInt(year) < 1970) {
        // remap into a 24 hour period.
        const totalSeconds = moment('1970-01-01').unix() - moment('1901-01-01').unix();
        const ratio = (moment(date, 'DD/MM/YYYY').unix() - moment('1901-01-01').unix()) / totalSeconds;
        const unixed = moment.unix(ratio * 86400);
        return `${unixed.format('YYYY-MM-DD HH:mm:ss')}`;
    }
    return `${year}-${month}-${day} 10:00:00`;
}

async function git(args: string[], date?: { author: string, committer: string }) {
    console.log('$ git', ...args);
    let env = { ...process.env };
    if (!date) {
        env.GIT_COMMITTER_DATE = env.GIT_AUTHOR_DATE = sanitiseGitDate('01/01/1970');
    } else if (date?.author) {
        args[args.length - 1] = `${date.committer ?? date.author}: ${args[args.length - 1]}`;
        env.GIT_COMMITTER_DATE = sanitiseGitDate(date.committer ?? date.author);
        env.GIT_AUTHOR_DATE = sanitiseGitDate(date.author);
    } else {
        args[args.length - 1] = `Pending: ${args[args.length - 1]}`;
        env.GIT_COMMITTER_DATE = env.GIT_AUTHOR_DATE = sanitiseGitDate('31/12/' + (new Date().getFullYear()));
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
await git(['commit', '-m', 'Commonwealth of Australia Constitution Act (The Constitution)'], { author: '01/01/1901', committer: '01/01/1901' });

// Go through each referendum, creating a branch for each and applying the patch.
//  todo: create a github pr.
// If the referendum is carried, ffw merge the main branch to it.
// Otherwise leave it be.

//const refDirs = (await fs.readdir('../referendums', { recursive: true, withFileTypes: true }))
//    .filter(dir => dir.isDirectory())
//    .map(dir => join(dir.path, dir.name));
// const refDirs = (await readdirp('../referendums', { type: 'directories' }))
//     .map(d => join('../referendums', d.path));

const referendumYears = from(await fs.readdir('../referendums'))
    .map(dir => join('../referendums', dir))
    .where(dir => !dir.includes('1899') && dir.split('/').length)
    .orderBy(dir => dir);

let branches: string[] = [];

let toMerge: { branch: string, date: string }[] = [];

for (const year of referendumYears) {
    const referendums = await Promise.all((await fs.readdir(year)).map(r => join(year, r))
        .sort()
        .map(async r => {
            const infoMd = await fs.readFile(join(r, 'info.md'), 'utf8');
            const info = frontMatter(infoMd).attributes as Info;
            return {
                dir: r,
                info
            }
        }));

    for (const { dir, info } of from(referendums).orderBy(x => x.info.outcome === 'carried' ? 1 : 0)) {
        const diffs = (await fs.readdir(dir)).filter(f => f.endsWith('diff')).sort();
        if (diffs.length === 0) continue;

        const branchName = dir.split('/').at(-1)!;
        branches.push(branchName);

        await git(['switch', '-c', branchName]);
        // apply changes
        for (const fn of diffs) {
            const diff = await fs.readFile(join(dir, fn), 'utf8');
            await fs.writeFile(constititionFilename, applyDiff(await fs.readFile(constititionFilename, 'utf8'), diff));
        }
        await git(['commit', '-am', info.name], { author: info.election_date, committer: info.effective_date });

        // swap back to main..
        await git(['switch', 'main']);

        if (info.outcome === 'carried') {
            // merge it in
            await git(['merge', '--ff-only', branchName]);
        }
    }
}

// Push all.

await git(['remote', 'add', 'origin', 'ssh://git@git.adam.id.au:222/adamburgess/australian-constitution.git'])
//await git(['remote', 'add', 'origin', 'ssh://git@github.com/adamburgess/australian-constitution.git'])
await git(['push', '-u', 'origin', '-f', 'main', ...branches]);

interface Info {
    outcome: 'carried' | 'rejected' | 'pending'
    name: string
    states: string
    percentage_for: number
    wiki: string
    election_date: string
    effective_date: string
}

async function mergeInReferendums(currentDate: string) {
    while (toMerge.length) {
        let { branch, date } = toMerge[0];

        console.log('checking if can merge', branch, 'from', date, 'to', currentDate);

        if (!moment(currentDate, 'DD/MM/YYYY').isSameOrAfter(moment(date, 'DD/MM/YYYY'),)) {
            return;
        }

        toMerge.shift();

        // should already be on master.
        await git(['merge', branch]);
    }
}
