<?php

namespace App\Modules\Settings;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;

/** Personalização do sistema (marca): nome, slogan, logo e cor primária. */
final class SettingsController
{
    private const MAX_LOGO_BYTES = 300_000; // ~300 KB em data URL

    /** Marca pública (tela de login carrega antes da autenticação). Org padrão. */
    public static function branding(Request $req): void
    {
        $row = Db::queryOne(
            'SELECT brand_name, tagline, logo, primary_color FROM organizations WHERE id = 1'
        ) ?? [];
        Http::json($row);
    }

    /** Atualiza a marca da org do usuário (guard system:admin). */
    public static function update(Request $req): void
    {
        $in = $req->input();
        $fields = [];
        $values = [];
        if ($in->has('brand_name')) {
            $fields[] = 'brand_name = ?';
            $values[] = $in->string('brand_name');
        }
        if ($in->has('tagline')) {
            $fields[] = 'tagline = ?';
            $values[] = $in->string('tagline');
        }
        if ($in->has('logo')) {
            $logo = $in->string('logo'); // data URL (image/*) ou null p/ remover
            if ($logo !== null) {
                if (!preg_match('#^data:image/(png|jpe?g|svg\+xml|webp);base64,#', $logo)) {
                    throw HttpError::badRequest('Logo inválida: envie uma imagem PNG, JPG, SVG ou WebP');
                }
                if (strlen($logo) > self::MAX_LOGO_BYTES) {
                    throw HttpError::badRequest('Logo muito grande (máx. ~200 KB). Reduza a imagem.');
                }
            }
            $fields[] = 'logo = ?';
            $values[] = $logo;
        }
        if ($in->has('primary_color')) {
            $color = $in->string('primary_color');
            if ($color !== null && !preg_match('/^#[0-9a-fA-F]{6}$/', $color)) {
                throw HttpError::badRequest('Cor inválida (use #RRGGBB)');
            }
            $fields[] = 'primary_color = ?';
            $values[] = $color;
        }
        if (!$fields) {
            throw HttpError::badRequest('Nada para atualizar');
        }
        $values[] = $req->orgId();
        Db::execute('UPDATE organizations SET ' . implode(', ', $fields) . ' WHERE id = ?', $values);
        $row = Db::queryOne('SELECT brand_name, tagline, logo, primary_color FROM organizations WHERE id = ?', [$req->orgId()]);
        Http::json($row);
    }
}
