/** Path rules shared by the scan, the evidence packet and the document reader. */
export type DocumentFormat = "markdown" | "rst" | "asciidoc";

const documentFormats = new Map<string, DocumentFormat>([
  ["md", "markdown"], ["markdown", "markdown"], ["mdx", "markdown"],
  ["rst", "rst"], ["adoc", "asciidoc"], ["asciidoc", "asciidoc"]
]);

/** The document format a path is read as, or undefined for source and data files. */
export function documentFormat(file: string): DocumentFormat | undefined {
  const extension = /\.([A-Za-z0-9]+)$/.exec(file)?.[1];
  return extension ? documentFormats.get(extension.toLowerCase()) : undefined;
}

export const isDocumentPath = (file: string): boolean => documentFormat(file) !== undefined;

const separatedTest = /(?:^|[/_.-])(?:tests?|specs?|__tests__)(?:[/_.-]|$)/i;
// FooTest.java, FooTests.swift, FooSpec.scala: the suffix convention of typed languages.
const suffixedTest = /[a-z0-9](?:Tests?|Specs?)\.[A-Za-z0-9]+$/;

export const isTestPath = (file: string): boolean => separatedTest.test(file) || suffixedTest.test(file);
