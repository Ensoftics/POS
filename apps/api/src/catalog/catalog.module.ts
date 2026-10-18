import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { CatalogController } from './catalog.controller';
import { CategoriesService } from './categories.service';
import { ProductImagesService } from './product-images.service';
import { ProductImportService } from './product-import.service';
import { ProductsService } from './products.service';

@Module({
  imports: [
    // Uploads are held in memory (bounded below) and never written to local disk.
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        limits: { fileSize: config.PRODUCT_IMAGE_MAX_BYTES, files: 1, fields: 0, parts: 1 },
      }),
    }),
  ],
  controllers: [CatalogController],
  providers: [CategoriesService, ProductsService, ProductImportService, ProductImagesService],
  exports: [ProductsService],
})
export class CatalogModule {}
