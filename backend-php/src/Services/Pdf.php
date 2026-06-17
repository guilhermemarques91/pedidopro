<?php

namespace App\Services;

/** Extração de texto de PDF (smalot/pdfparser). */
final class Pdf
{
    public static function extractText(string $binary): string
    {
        if (!class_exists(\Smalot\PdfParser\Parser::class)) {
            return '';
        }
        try {
            $parser = new \Smalot\PdfParser\Parser();
            $doc = $parser->parseContent($binary);
            return trim($doc->getText());
        } catch (\Throwable) {
            return '';
        }
    }
}
