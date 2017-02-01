const parser = require('./tasks/parser');
const tokens = require('./tasks/tokens');
const Markdown = require('./generator/markdown');
const errHandler = require('./common/errHandler');
const path = require('path');
const fs = require('fs');
const showdown = require('showdown');

let verbose = true;

const readDirRecursive = (fromPath) => {
  let result = [];
  let contents = fs.readdirSync(fromPath);
  for (let item of contents) {
    item = path.resolve(fromPath, item);
    if (!fs.statSync(item).isFile()) {
      result = result.concat(readDirRecursive(item));
    } else if (path.extname(item) === '.json') {
      result.push(item);
    }
  }
  return result;
};
const mkdirRecursive = (pathName) => {
  let paths = pathName.split(path.sep);
  let pathParts = '';
  paths.map((pathPart) => {
    pathParts += pathPart + path.sep;
    if (pathPart === '') {
      return;
    }
    if (!fs.existsSync(pathParts)) {
      fs.mkdirSync(pathParts);
    }
  });
};

const output = (msg) => {
  if (verbose) {
    console.log(msg);
  }
}

const setDocMap = (docMap, elmData) => {
  let tree = docMap;
  let dirStep = '';
  for (item of elmData.dirs) {
    if (!tree[item]) {
      tree[item] = {
        name: item,
        label: item.replace(new RegExp('\\_', 'g'), ' ').replace(new RegExp('\\.', 'g'), ' '),
        path: dirStep + item,
        uri: dirStep + item,
        isLeaf: false,
        childs: {}
      };
      dirStep += item + path.sep;
    }
    tree = tree[item].childs;
  }
  if (!tree[elmData.name]) {
    tree[elmData.name] = {
      name: elmData.name,
      label: elmData.name.replace(new RegExp('\\_', 'g'), ' ').replace(new RegExp('\\.', 'g'), ' '),
      path: elmData.dir,
      uri: elmData.dir.replace(new RegExp(path.sep, 'g'), '.') + '.' + elmData.name + '.html',
      isLeaf: true,
      childs: null
    };
  }
}

const getDocMap = (inputs, inputPath, outputPath) => {
  let result = {};
  inputs.map((fullFileName) => {
    let docElm = {};
    let filePath = path.relative(inputPath, fullFileName);
    let pathObj = path.parse(filePath);
    pathObj.dirs = pathObj.dir.split(path.sep);
    setDocMap(result, pathObj);
  });
  return result;
}

const regexDocMap = (regex, html, grIndex) => {
  let m;
  let result = '';
  while ((m = regex.exec(html)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches
    if (m.index === regex.lastIndex) {
        regex.lastIndex++;
    }

    // The result can be accessed through the `m`-variable.
    m.forEach((match, groupIndex) => {
        if (groupIndex === grIndex) {
          result = match;
        }
    });
  }
  return result;
}

const getDocMapHTML = (docMapPart, dtTemplates, dtRegex, itemLevel) => {
  let result = '';
  if (!docMapPart.isLeaf) {
    let part = (itemLevel>1?dtTemplates.dtBranchT:dtTemplates.dtBranchRootT)
      .replace(new RegExp('\\$\\{itemLevel\\}', 'g'), itemLevel)
      .replace(new RegExp('\\$\\{itemIndent\\}', 'g'), itemLevel>2?'is-indent':'');

    for (let item in docMapPart) {
      let propRegex = dtRegex.dtBranchProp.replace(new RegExp('\\$\\{property\\}', 'g'), item);
      part = part.replace(new RegExp(propRegex, 'g'), docMapPart[item]);
    }

    let childs = '';
    for (let item in docMapPart.childs) {
      childs += getDocMapHTML(docMapPart.childs[item], dtTemplates, dtRegex, itemLevel + 1);
    }
    part = part.replace(new RegExp(itemLevel>1?dtRegex.dtBranchChilds:dtRegex.dtBranchRootChilds, 'g'), childs);
    result += part;
  } else {
    let part = dtTemplates.dtBranchLeafT
      .replace(new RegExp('\\$\\{itemLevel\\}', 'g'), itemLevel)
      .replace(new RegExp('\\$\\{itemIndent\\}', 'g'), itemLevel>2?'is-indent':'');;

    for (let item in docMapPart) {
      let propRegex = dtRegex.dtBranchLeafProp.replace(new RegExp('\\$\\{property\\}', 'g'), item);
      part = part.replace(new RegExp(propRegex, 'g'), docMapPart[item]);
    }
    result += part;
  }
  return result;
}

const applyDocMapStateActive = (itemUri, html) => {
  return html
    .replace(new RegExp('\\$\\{' + itemUri + '\\.itemState\\}', 'g'), 'is-active')
    .replace(new RegExp('\\$\\{.*\\.itemState\\}', 'g'), '');
}

const applyDocMap = (docMap, html) => {
  const dtRegex = {
    dtRoot: /<doctree-root>([\s\S]*)<\/doctree-root>/g,
    dtBranchRoot: /<doctree-branch-root>([\s\S]*)<\/doctree-branch-root>/g,
    dtBranchRootChilds: /<doctree-branch-root-childs>([\s\S]*)<\/doctree-branch-root-childs>/g,
    dtBranch: /<doctree-branch>([\s\S]*)<\/doctree-branch>/g,
    dtBranchProp: '<doctree-branch-\$\{property\}\/>',
    dtBranchChilds: /<doctree-branch-childs>([\s\S]*)<\/doctree-branch-childs>/g,
    dtBranchLeaf: /<doctree-branch-leaf>([\s\S]*)<\/doctree-branch-leaf>/g,
    dtBranchLeafProp: '<doctree-leaf-\$\{property\}\/>'
  };
  let dtTemplates = {};
  dtTemplates.dtRootT = regexDocMap(dtRegex.dtRoot, html, 1),
  dtTemplates.dtBranchRootT = regexDocMap(dtRegex.dtBranchRoot, dtTemplates.dtRootT, 1),
  dtTemplates.dtBranchRootChildsT = regexDocMap(dtRegex.dtBranchRootChilds, dtTemplates.dtBranchRootT, 1),
  dtTemplates.dtBranchT = regexDocMap(dtRegex.dtBranch, dtTemplates.dtRootT, 1),
  dtTemplates.dtBranchChildsT = regexDocMap(dtRegex.dtBranchChilds, dtTemplates.dtBranchT, 1),
  dtTemplates.dtBranchLeafT = regexDocMap(dtRegex.dtBranchLeaf, dtTemplates.dtBranchChildsT, 1)

  let result = '';
  for (let item in docMap) {
    let itemHtml = getDocMapHTML(docMap[item], dtTemplates, dtRegex, 1);
    result += itemHtml;
  }
  return html
    .replace(new RegExp(dtRegex.dtRoot, 'g'), dtTemplates.dtRootT
    .replace(new RegExp(dtRegex.dtBranchRoot, 'g'), '')
    .replace(new RegExp(dtRegex.dtBranch, 'g'), result));
}

const process = (inFile, outFile, options, callback) => {
  let writeFile = true;
  let headerFile = null;
  let footerFile = null;
  if (options === true || options === false) {
    writeFile = options;
  } else {
    writeFile = options.writeFile === true;
    headerFile = options.headerFile;
    footerFile = options.footerFile;
    verbose = options.verbose === true;
  }

  if (!inFile) {
    errHandler('No File, exiting!', 'err');
    return callback('No File', null);
  }
  let tmpFile = path.basename(inFile).split('.');
  tmpFile.pop();
  const outputFile = outFile || `${tmpFile.join('.')}.html`; //`${path.basename(inFile).split('.')[0]}.md`;
  let totalFiles = 1;
  let processedFiles = 0;
  try {
    output(`Processing ${path.basename(inFile)} [${++processedFiles}/${totalFiles}]`);
    const schema = parser(inFile, tokens);
    const generator = new Markdown(tokens);
    let header = '';
    let footer = '';
    if (headerFile && fs.existsSync(headerFile)) {
      header = fs.readFileSync(headerFile);
    }
    if (footerFile && fs.existsSync(footerFile)) {
      footer = fs.readFileSync(footerFile);
    }
    let MdToHTML = new showdown.Converter({tables: true, simpleLineBreaks: true, literalMidWordUnderscores: true});
    schema.parse((err) => {
      if (err) {
        errHandler(err, 'err');
        return callback(err, null);
      }
      let mdOutput = generator.generate();
      mdOutput = MdToHTML.makeHtml(mdOutput);
      if (writeFile) {
        fs.writeFileSync(`${outputFile}`, header + mdOutput + footer, {'flag':'w'}); // creates a file and output
      }
      return callback(null, mdOutput); // returns an output
    });
  } catch (e) {
    errHandler(e, 'err');
    return callback(e, null);
  }
};

const processPath = (inPath, outPath, options, callback) => {
  let writeFile = true;
  let headerFile = null;
  let footerFile = null;
  let indexFile = null;
  if (options === true || options === false) {
    writeFile = options;
  } else {
    writeFile = options.writeFile === true;
    headerFile = options.headerFile;
    footerFile = options.footerFile;
    indexFile = options.indexFile;
    verbose = options.verbose === true;
  }
  if (!inPath) {
    errHandler('No Path, exiting!', 'err');
    return callback('No Path', null);
  }
  let files = readDirRecursive(inPath);
  let totalFiles = files.length;
  let processedFiles = 0;
  let outputPath = outPath || inPath + path.sep + 'md';
  let doc = getDocMap(files, inPath, outputPath);
  try {
    let header = '';
    let footer = '';
    let index = '';
    if (headerFile && fs.existsSync(headerFile)) {
      header = fs.readFileSync(headerFile, 'utf8');
      header = applyDocMap(doc, header);
    }
    if (footerFile && fs.existsSync(footerFile)) {
      footer = fs.readFileSync(footerFile, 'utf8');
      footer = applyDocMap(doc, footer);
    }
    let MdToHTML = new showdown.Converter({tables: true, simpleLineBreaks: true, literalMidWordUnderscores: true});
    // index generator
    if (indexFile && fs.existsSync(indexFile)) {
      index = fs.readFileSync(indexFile, 'utf8');
      index = applyDocMap(doc, index);
      if (writeFile) {
        mkdirRecursive(outputPath);
        fs.writeFileSync(path.resolve(outputPath, 'index.html'), applyDocMapStateActive('index.html', header) + index + applyDocMapStateActive('index.html', footer), {'flag':'w'}); // creates a file and output
      }
    }
    files.map((file)=>{
      output(`Processing ${path.basename(file)} [${++processedFiles}/${totalFiles}]`);
      let tmpFile = path.relative(inPath, file).split('.');
      tmpFile.pop();
      let outputFile = `${tmpFile.join('.')}.html`;
      file = path.resolve(inPath, file);
      if (!fs.statSync(file).isFile()) {
        return false;
      }
      outputFile = path.resolve(outputPath, outputFile.replace(new RegExp(path.sep, 'g'), '.'));
      let mdOutput = '';
      let hasError = false;
      try {
        tokens.tokens = {};
        let schema = parser(file, tokens);
        let generator = new Markdown(tokens);
        schema.parse((err) => {
          if (err) {
            errHandler(err, 'err');
            //return callback(err, null);
          }
          mdOutput = generator.generate();
          mdOutput = MdToHTML.makeHtml(mdOutput);
          return callback(null, mdOutput); // returns an output
        });
      } catch(e) {
        errHandler(e, 'err');
      }
      if (writeFile) {
        mkdirRecursive(outputPath/*path.dirname(outputFile)*/);
        fs.writeFileSync(`${outputFile}`, applyDocMapStateActive(path.basename(outputFile), header) + mdOutput + applyDocMapStateActive(path.basename(outputFile), footer), {'flag':'w'}); // creates a file and output
      }
    }, this);
  } catch (e) {
    errHandler(e, 'err');
    return callback(e, null);
  }
};

module.exports = {
  process: process,
  processPath: processPath
};
