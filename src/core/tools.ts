import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import globOriginal from 'glob';
import { logger } from './initLogger';

const glob = promisify(globOriginal);

function shouldIgnoreFile(filePath: string): boolean {
  return filePath.includes('node_modules');
}

function shouldExclude(file: string): boolean {
  return file.includes('node_modules') || fs.statSync(file).isDirectory();
}

export async function findFilesByName(pattern: string, workingDir: string): Promise<string[]> {
  try {
    const files = await glob(pattern, { cwd: workingDir, absolute: true, nodir: true, ignore: '**/node_modules/**' });
    return files
      .filter((file: string) => !shouldExclude(file))
      .map((file: string) => path.relative(workingDir, file));
  } catch (error) {
    logger.logToolStderr(`Error in findFilesByName: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export async function findFilesByContent(pattern: string, workingDir: string): Promise<string[]> {
  const allFiles = await findFilesByName('**/*', workingDir);
  const matchingFiles: string[] = [];

  logger.logMainFlow(`Searching ${allFiles.length} files for pattern: ${pattern}`);

  for (const file of allFiles) {
    try {
      const fullPath = path.join(workingDir, file);
      if (shouldExclude(fullPath)) continue;
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      if (content.includes(pattern)) {
        matchingFiles.push(file);
        logger.logMainFlow(`Found match in file: ${file}`);
      }
    } catch (error) {
      logger.logToolStderr(`Error reading file ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  logger.logMainFlow(`Found ${matchingFiles.length} files containing the pattern`);
  return matchingFiles;
}

export async function findImportedFiles(file: string, workingDir: string): Promise<string[]> {
  try {
    const fullPath = path.resolve(workingDir, file);
    const content = await fs.promises.readFile(fullPath, 'utf-8');
    const importRegex = /import.*from\s+['"](.+)['"]/g;
    const imports: string[] = [];
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath.startsWith('.')) {
        // Resolve relative imports
        const resolvedPath = path.resolve(path.dirname(fullPath), importPath);
        imports.push(path.relative(workingDir, resolvedPath));
      } else {
        // For non-relative imports, just add the import path
        imports.push(importPath);
      }
    }

    return imports;
  } catch (error) {
    logger.logToolStderr(`Error reading file ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function resolveImportPath(baseFile: string, importPath: string): string {
  if (importPath.startsWith('.')) {
    return path.resolve(path.dirname(baseFile), importPath);
  }
  return importPath;
}

export async function findRelatedTests(fileOrDir: string, workingDir: string): Promise<string[]> {
  const fullPath = path.resolve(workingDir, fileOrDir);
  try {
    const stats = await fs.promises.stat(fullPath);
    if (stats.isDirectory()) {
      const testPattern = path.join(fileOrDir, '**/*.test.{ts,tsx,js,jsx}');
      return findFilesByName(testPattern, workingDir);
    } else {
      const baseName = path.basename(fileOrDir, path.extname(fileOrDir));
      const testPattern = `**/${baseName}.test.{ts,tsx,js,jsx}`;
      return findFilesByName(testPattern, workingDir);
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.logToolStderr(`File or directory not found: ${fileOrDir}`);
    } else {
      logger.logToolStderr(`Error in findRelatedTests: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }
}

export async function findComponentUsage(component: string, workingDir: string): Promise<string[]> {
  const pattern = `<${component}`;
  return findFilesByContent(pattern, workingDir);
}

export async function findAPIUsage(endpoint: string, workingDir: string): Promise<string[]> {
  const pattern = `fetch(.*${endpoint}.*)`; // This is a simplified pattern
  return findFilesByContent(pattern, workingDir);
}

export async function findStyleDependencies(component: string, workingDir: string): Promise<string[]> {
  const componentFiles = await findFilesByName(`**/${component}.{ts,tsx,js,jsx}`, workingDir);
  const styleFiles: string[] = [];

  for (const file of componentFiles) {
    const fullPath = path.join(workingDir, file);
    const content = await fs.promises.readFile(fullPath, 'utf-8');
    const styleImportRegex = /import.*from\s+['"](.+\.(?:css|scss))['"]/g;
    let match;

    while ((match = styleImportRegex.exec(content)) !== null) {
      const stylePath = path.relative(workingDir, resolveImportPath(fullPath, match[1]));
      if (!shouldIgnoreFile(stylePath)) {
        styleFiles.push(stylePath);
      }
    }
  }

  return styleFiles;
}

export async function findFunctionDefinition(functionName: string, workingDir: string): Promise<string[]> {
  const pattern = `function\\s+${functionName}\\s*\\(|const\\s+${functionName}\\s*=\\s*\\(|let\\s+${functionName}\\s*=\\s*\\(|var\\s+${functionName}\\s*=\\s*\\(`;
  return findFilesByContent(pattern, workingDir);
}

export async function findDependencies(file: string, workingDir: string): Promise<string[]> {
  const fullPath = path.join(workingDir, file);
  const content = await fs.promises.readFile(fullPath, 'utf-8');
  const dependencyRegex = /import.*from\s+['"](.+)['"]/g;
  const dependencies: string[] = [];
  let match;

  while ((match = dependencyRegex.exec(content)) !== null) {
    if (!shouldIgnoreFile(match[1])) {
      dependencies.push(match[1]);
    }
  }

  return dependencies;
}

export async function findRecentlyModifiedFiles(days: number, workingDir: string): Promise<string[]> {
  const allFiles = await findFilesByName('**/*', workingDir);
  const now = new Date();
  const recentFiles: string[] = [];

  for (const file of allFiles) {
    if (shouldIgnoreFile(file)) continue;
    const fullPath = path.join(workingDir, file);
    const stats = await fs.promises.stat(fullPath);
    const modifiedTime = new Date(stats.mtime);
    const diffTime = Math.abs(now.getTime() - modifiedTime.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= days) {
      recentFiles.push(file);
    }
  }

  return recentFiles;
}

export async function findRelatedClasses(file: string, workingDir: string): Promise<string[]> {
  try {
    const content = await fs.promises.readFile(path.join(workingDir, file), 'utf-8');
    const relatedFiles: string[] = [];

    // Find import statements
    const importRegex = /import\s+{?\s*(\w+)\s*}?\s+from\s+['"](.+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const [, importedClass, importPath] = match;
      const absolutePath = path.resolve(path.dirname(path.join(workingDir, file)), importPath);
      const relativePath = path.relative(workingDir, absolutePath);
      relatedFiles.push(relativePath + (path.extname(relativePath) ? '' : '.ts'));
    }

    // Find class extensions
    const extensionRegex = /class\s+(\w+)\s+extends\s+(\w+)/g;
    while ((match = extensionRegex.exec(content)) !== null) {
      const [, , baseClass] = match;
      // We need to find where this base class is defined
      const baseClassFiles = await findFilesByContent(`class ${baseClass}`, workingDir);
      relatedFiles.push(...baseClassFiles);
    }

    return [...new Set(relatedFiles)]; // Remove duplicates
  } catch (error) {
    logger.logToolStderr(`Error in findRelatedClasses for file ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export async function findExternalDependency(moduleName: string, workingDir: string): Promise<string[]> {
  const possiblePaths = [
    path.join(workingDir, 'node_modules', moduleName, 'index.d.ts'),
    path.join(workingDir, 'node_modules', moduleName, 'index.js'),
    path.join(workingDir, 'node_modules', '@types', moduleName, 'index.d.ts'),
  ];

  const existingPaths = await Promise.all(
    possiblePaths.map(async (p) => {
      try {
        await fs.promises.stat(p);
        return p;
      } catch (error) {
        // Only log errors for unexpected situations
        if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {

          console.error(`Unexpected error checking path ${p} for ${moduleName}:`, error);
        }
        return null;
      }
    })
  );

  return existingPaths.filter((p): p is string => p !== null).map(p => path.relative(workingDir, p));
}