export function applyDiff(text: string, diff: string) {
    let lines = text.split('\n');
    const diffLines = diff.split('\n').map(dl => ({
        type: dl[0],
        line: dl.substring(1)
    }));
    if (diffLines.at(-1)!.line === '') diffLines.pop();

    let diffOriginal = 0;
    for (let i = 0; i < diffLines.length; i++) {
        if (diffLines[i].type === ' ') diffOriginal++;
        if (diffLines[i].type === '-') diffOriginal++;
    }

    let diffFirst = diffLines[0].line;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === diffFirst) {
            let matches = true;
            for (let lineIndex = 1, diffIndex = 1; diffIndex < diffLines.length; lineIndex++, diffIndex++) {
                if (diffLines[diffIndex].type == '+') {
                    // skip
                    lineIndex--;
                } else {
                    if (lines[i + lineIndex] !== diffLines[diffIndex].line) {
                        matches = false;
                        break;
                    }
                }
            }

            if (matches) {
                // remove original and insert changed
                let newLines: string[] = diffLines.filter(x => x.type !== '-').map(x => x.line);
                lines.splice(i, diffOriginal, ...newLines);
                return lines.join('\n');
            }
        }
    }

    throw new Error('diff can not be applied');
}
